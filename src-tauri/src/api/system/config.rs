use crate::domain::engine::manager::EngineManager;
use crate::domain::modules::downloader;
use crate::domain::system::config_service::ConfigService;
use crate::errors::AppError;
use crate::models::config::{
    ApiProvider, AppConfig, CatalogAppItem, CatalogProviderPolicy, CatalogSnapshot, ModuleItem,
};
use crate::models::modules::Module;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::State;

const SHARED_CLOUD_KEY_PROVIDER_ID: &str = "cloud";
const SHARED_CLOUD_SECRET_SERVICE: &str = "cloud_api_key";
const OPENROUTER_KEY_URL: &str = "https://openrouter.ai/settings/keys";
const CUSTOM_TEXT_PROVIDER_ID: &str = "custom-text";
const CUSTOM_IMAGE_PROVIDER_ID: &str = "custom-image";

#[tauri::command]
#[specta::specta]
/// Loads application configuration with module installation status
pub async fn get_config(
    config_service: State<'_, Arc<ConfigService>>,
) -> Result<AppConfig, AppError> {
    let mut config = config_service.load_full_config()?;

    // Populate installed status for each module
    for module in &mut config.catalog.ai {
        module.installed = downloader::is_module_installed(&module.id);
    }
    for module in &mut config.catalog.services {
        module.installed = downloader::is_module_installed(&module.id);
    }

    Ok(config)
}

#[tauri::command]
#[specta::specta]
/// Returns a frontend-ready catalog snapshot with backend-owned installation and provider metadata.
pub async fn get_catalog_snapshot(
    config_service: State<'_, Arc<ConfigService>>,
    engine_manager: State<'_, Arc<EngineManager>>,
) -> Result<CatalogSnapshot, AppError> {
    let config = get_config(config_service).await?;
    let modules = crate::domain::modules::controller::get_all_modules().await;
    let engine_defs = engine_manager.list_definitions().await;
    Ok(build_catalog_snapshot(config, modules, engine_defs))
}

fn build_catalog_snapshot(
    config: AppConfig,
    installed_modules: Vec<Module>,
    mut engine_defs: Vec<crate::domain::engine::types::EngineDefinition>,
) -> CatalogSnapshot {
    mark_engine_definitions_installed(&mut engine_defs);

    let installed_modules_by_id = installed_modules
        .into_iter()
        .map(|module| (module.id.to_ascii_lowercase(), module))
        .collect::<HashMap<_, _>>();
    let engine_defs_by_id = engine_defs
        .into_iter()
        .map(|engine| (engine.id.to_ascii_lowercase(), engine))
        .collect::<HashMap<_, _>>();
    let api_providers_by_id = config
        .api_providers
        .iter()
        .cloned()
        .map(|provider| (provider.id.to_ascii_lowercase(), provider))
        .collect::<HashMap<_, _>>();

    let mut known_ids = HashSet::new();
    let mut ai = config
        .catalog
        .ai
        .iter()
        .map(|item| {
            known_ids.insert(item.id.to_ascii_lowercase());
            build_catalog_item(
                item,
                "ai",
                &api_providers_by_id,
                &installed_modules_by_id,
                &engine_defs_by_id,
            )
        })
        .collect::<Vec<_>>();

    append_custom_provider_items(&mut ai, &mut known_ids);

    let mut services = config
        .catalog
        .services
        .iter()
        .map(|item| {
            known_ids.insert(item.id.to_ascii_lowercase());
            build_catalog_item(
                item,
                "services",
                &api_providers_by_id,
                &installed_modules_by_id,
                &engine_defs_by_id,
            )
        })
        .collect::<Vec<_>>();

    services.extend(
        installed_modules_by_id
            .values()
            .filter(|module| !known_ids.contains(&module.id.to_ascii_lowercase()))
            .map(build_discovered_integration_item),
    );

    CatalogSnapshot {
        ai,
        services,
        stars: config.catalog.stars,
    }
}

fn mark_engine_definitions_installed(defs: &mut [crate::domain::engine::types::EngineDefinition]) {
    for def in defs {
        def.installed = def.managed_externally
            || crate::domain::engine::detector::is_engine_installed(&def.id, def.binary.as_deref());
        def.installed_compute_modes = if def.installed && !def.managed_externally {
            crate::domain::engine::detector::installed_compute_modes(&def.id)
        } else {
            Vec::new()
        };
    }
}

fn build_catalog_item(
    item: &ModuleItem,
    category: &str,
    api_providers_by_id: &HashMap<String, ApiProvider>,
    installed_modules_by_id: &HashMap<String, Module>,
    engine_defs_by_id: &HashMap<String, crate::domain::engine::types::EngineDefinition>,
) -> CatalogAppItem {
    let key = item.id.to_ascii_lowercase();
    let api_provider = api_providers_by_id.get(&key).cloned();
    let installed_module = installed_modules_by_id.get(&key);
    let engine = engine_defs_by_id.get(&key);
    let capability = primary_capability(&item.capabilities);
    let is_api = item.type_name != "local" || api_provider.is_some();
    let installed = if item.coming_soon {
        false
    } else if item.managed_externally || is_api {
        true
    } else if let Some(engine) = engine {
        engine.installed
    } else {
        installed_module.is_some()
    };

    CatalogAppItem {
        id: item.id.clone(),
        name_key: Some(item.name_key.clone()),
        desc_key: Some(item.desc_key.clone()),
        name: Some(item.name.clone()),
        desc: Some(item.desc.clone()),
        icon: Some(item.icon.clone()),
        preview: installed_module
            .and_then(|module| module.preview.clone())
            .or_else(|| item.preview.clone()),
        category: category.to_string(),
        type_name: if category == "ai" && item.type_name != "local" {
            "api".to_string()
        } else {
            "local".to_string()
        },
        capability: capability.clone(),
        installed,
        installed_compute_modes: engine
            .map(|engine| {
                engine
                    .installed_compute_modes
                    .iter()
                    .map(|mode| match mode {
                        crate::domain::engine::types::EngineComputeMode::Gpu => "gpu".to_string(),
                        crate::domain::engine::types::EngineComputeMode::Cpu => "cpu".to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        repo_url: item.repo_url.clone(),
        expected_hash: item.expected_hash.clone(),
        dl_type: item.dl_type.clone(),
        coming_soon: item.coming_soon,
        managed_externally: item.managed_externally,
        version: item.version.clone(),
        config_schema: installed_module
            .and_then(|module| module.config_schema.clone())
            .or_else(|| item.config_schema.clone()),
        settings_ui: installed_module.and_then(|module| module.settings_ui.clone()),
        api_provider_data: api_provider.clone(),
        status: installed_module.and_then(|module| module.status.clone()),
        provider_policy: Some(build_provider_policy(
            &item.id,
            category,
            &item.type_name,
            capability.as_deref(),
            api_provider.as_ref(),
        )),
    }
}

fn build_discovered_integration_item(module: &Module) -> CatalogAppItem {
    CatalogAppItem {
        id: module.id.clone(),
        name_key: None,
        desc_key: None,
        name: Some(
            module
                .preview
                .as_ref()
                .and_then(|preview| preview.title.clone())
                .unwrap_or_else(|| module.name.clone()),
        ),
        desc: Some(
            module
                .preview
                .as_ref()
                .and_then(|preview| preview.description.clone())
                .unwrap_or_else(|| module.description.clone()),
        ),
        icon: Some(
            module
                .preview
                .as_ref()
                .and_then(|preview| preview.sticker.clone())
                .unwrap_or_else(|| module.icon.clone()),
        ),
        preview: module.preview.clone(),
        category: "services".to_string(),
        type_name: "local".to_string(),
        capability: Some("text".to_string()),
        installed: true,
        installed_compute_modes: Vec::new(),
        repo_url: None,
        expected_hash: None,
        dl_type: None,
        coming_soon: false,
        managed_externally: false,
        version: module.version.clone(),
        config_schema: module.config_schema.clone(),
        settings_ui: module.settings_ui.clone(),
        api_provider_data: None,
        provider_policy: Some(build_provider_policy(
            &module.id,
            "services",
            "local",
            Some("text"),
            None,
        )),
        status: module.status.clone(),
    }
}

fn append_custom_provider_items(ai: &mut Vec<CatalogAppItem>, known_ids: &mut HashSet<String>) {
    let custom_specs = [
        (
            CUSTOM_TEXT_PROVIDER_ID,
            "text",
            "Custom",
            "ui.launcher.app.custom_text.name",
            "Use any text model by pasting its model ID manually.",
            "ui.launcher.app.custom_text.desc",
            "🔤",
        ),
        (
            CUSTOM_IMAGE_PROVIDER_ID,
            "image",
            "Custom",
            "ui.launcher.app.custom_image.name",
            "Use any image model by pasting its model ID manually.",
            "ui.launcher.app.custom_image.desc",
            "🪄",
        ),
    ];

    for (id, capability, name, name_key, desc, desc_key, icon) in custom_specs {
        if !known_ids.insert(id.to_string()) {
            continue;
        }

        let capability = Some(capability.to_string());
        ai.push(CatalogAppItem {
            id: id.to_string(),
            name_key: Some(name_key.to_string()),
            desc_key: Some(desc_key.to_string()),
            name: Some(name.to_string()),
            desc: Some(desc.to_string()),
            icon: Some(icon.to_string()),
            preview: None,
            category: "ai".to_string(),
            type_name: "api".to_string(),
            capability: capability.clone(),
            installed: true,
            installed_compute_modes: Vec::new(),
            repo_url: None,
            expected_hash: None,
            dl_type: None,
            coming_soon: false,
            managed_externally: false,
            version: "1.0.0".to_string(),
            config_schema: None,
            settings_ui: None,
            api_provider_data: Some(ApiProvider {
                id: id.to_string(),
                name: name.to_string(),
                desc_key: Some(desc_key.to_string()),
                description: Some(desc.to_string()),
                icon: Some(icon.to_string()),
                provider_type: Some(crate::models::config::ProviderType::OpenaiCompatible),
                base_url: Some("https://openrouter.ai/api/v1".to_string()),
                api_key_env: None,
                models: Some(Vec::new()),
                capabilities: Some(vec![capability.clone().unwrap_or_default()]),
                model_aliases: None,
            }),
            provider_policy: Some(build_provider_policy(
                id,
                "ai",
                "api",
                capability.as_deref(),
                None,
            )),
            status: None,
        });
    }
}

fn primary_capability(capabilities: &[String]) -> Option<String> {
    if capabilities.iter().any(|capability| capability == "image") {
        return Some("image".to_string());
    }

    if capabilities.iter().any(|capability| capability == "text") {
        return Some("text".to_string());
    }

    None
}

fn build_provider_policy(
    id: &str,
    category: &str,
    type_name: &str,
    capability: Option<&str>,
    api_provider: Option<&ApiProvider>,
) -> CatalogProviderPolicy {
    let is_custom_provider = is_custom_provider(id);
    let is_cloud_provider = type_name != "local" || api_provider.is_some() || is_custom_provider;
    let image_only = capability == Some("image") || id == CUSTOM_IMAGE_PROVIDER_ID;
    let is_clean_app = matches!(id, "axelate" | "axelate-platform");
    let secret_service = provider_secret_service(id, is_cloud_provider);
    let uses_custom_provider_key = is_custom_provider;
    let key_provider_id = secret_service.as_ref().map(|service| {
        if service == SHARED_CLOUD_SECRET_SERVICE {
            SHARED_CLOUD_KEY_PROVIDER_ID.to_string()
        } else {
            id.to_string()
        }
    });
    let supports_thinking = !is_custom_provider
        && api_provider
            .and_then(|provider| provider.models.as_ref())
            .is_some_and(|models| {
                models.iter().any(|model| {
                    model
                        .capabilities
                        .as_ref()
                        .is_some_and(|capabilities| capabilities.reasoning)
                })
            });

    CatalogProviderPolicy {
        is_cloud_provider,
        is_custom_provider,
        is_clean_app,
        secret_service,
        key_provider_id: key_provider_id.clone(),
        key_provider_url: key_provider_id
            .filter(|provider_id| provider_id == SHARED_CLOUD_KEY_PROVIDER_ID)
            .map(|_| OPENROUTER_KEY_URL.to_string()),
        uses_custom_provider_key,
        show_api_endpoint_selector: id == CUSTOM_TEXT_PROVIDER_ID,
        show_custom_model_composer: is_custom_provider,
        show_model_stats: !is_custom_provider,
        supports_internet_access: category == "ai"
            && is_cloud_provider
            && !is_clean_app
            && !is_custom_provider
            && !image_only,
        supports_thinking,
        image_only,
    }
}

fn provider_secret_service(id: &str, is_cloud_provider: bool) -> Option<String> {
    if !is_cloud_provider {
        return None;
    }

    if is_custom_provider(id) {
        return Some(format!("{}_api_key", id.replace('-', "_")));
    }

    Some(SHARED_CLOUD_SECRET_SERVICE.to_string())
}

fn is_custom_provider(id: &str) -> bool {
    id == CUSTOM_TEXT_PROVIDER_ID || id == CUSTOM_IMAGE_PROVIDER_ID
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::config::{ConfigCatalog, ProviderType};
    use crate::models::modules::ModulePreview;

    fn module_item(id: &str, category_type: &str) -> ModuleItem {
        ModuleItem {
            id: id.to_string(),
            name_key: format!("catalog.{id}.name"),
            desc_key: format!("catalog.{id}.desc"),
            name: id.to_string(),
            desc: format!("{id} description"),
            icon: "icon".to_string(),
            preview: None,
            type_name: category_type.to_string(),
            dl_type: None,
            capabilities: vec!["text".to_string()],
            binary: None,
            repo_url: None,
            expected_hash: None,
            coming_soon: false,
            managed_externally: false,
            version: "1.0.0".to_string(),
            installed: false,
            raw_config_schema: None,
            config_schema: None,
        }
    }

    fn app_config(ai: Vec<ModuleItem>, services: Vec<ModuleItem>) -> AppConfig {
        AppConfig {
            version: "1.0.0".to_string(),
            api_providers: vec![ApiProvider {
                id: "openai".to_string(),
                name: "OpenAI".to_string(),
                desc_key: None,
                description: None,
                icon: None,
                provider_type: Some(ProviderType::OpenaiCompatible),
                base_url: Some("https://openrouter.ai/api/v1".to_string()),
                api_key_env: Some("OPENROUTER_API_KEY".to_string()),
                models: None,
                capabilities: Some(vec!["text".to_string()]),
                model_aliases: None,
            }],
            catalog: ConfigCatalog {
                ai,
                services,
                stars: vec!["openai".to_string()],
            },
        }
    }

    fn installed_module(id: &str) -> Module {
        Module {
            id: id.to_string(),
            name: id.to_string(),
            description: format!("{id} module"),
            version: "0.1.0".to_string(),
            author: "test".to_string(),
            category: "service".to_string(),
            icon: "plug".to_string(),
            preview: Some(ModulePreview {
                title: Some(format!("{id} title")),
                description: Some(format!("{id} preview")),
                sticker: Some("*".to_string()),
                image: None,
                i18n: None,
            }),
            path: format!("C:/tmp/{id}"),
            installed: true,
            local: true,
            enabled: true,
            status: Some("stopped".to_string()),
            is_deletable: true,
            config: HashMap::new(),
            config_schema: None,
            settings_ui: Some("settings-ui/index.html".to_string()),
        }
    }

    #[test]
    fn catalog_snapshot_marks_api_and_catalog_integrations_from_backend_inputs() {
        let mut openai = module_item("openai", "api");
        openai.capabilities = vec!["text".to_string(), "image".to_string()];
        let worker = module_item("worker", "local");

        let snapshot = build_catalog_snapshot(
            app_config(vec![openai], vec![worker]),
            vec![installed_module("worker")],
            Vec::new(),
        );

        let openai_card = snapshot.ai.iter().find(|item| item.id == "openai");
        assert_eq!(openai_card.map(|item| item.type_name.as_str()), Some("api"));
        assert_eq!(openai_card.map(|item| item.installed), Some(true));
        assert_eq!(
            openai_card.and_then(|item| item.capability.as_deref()),
            Some("image")
        );
        assert_eq!(
            openai_card.map(|item| item.api_provider_data.is_some()),
            Some(true)
        );
        assert_eq!(
            openai_card.and_then(|item| item.provider_policy.as_ref()),
            Some(&CatalogProviderPolicy {
                is_cloud_provider: true,
                is_custom_provider: false,
                is_clean_app: false,
                secret_service: Some(SHARED_CLOUD_SECRET_SERVICE.to_string()),
                key_provider_id: Some(SHARED_CLOUD_KEY_PROVIDER_ID.to_string()),
                key_provider_url: Some(OPENROUTER_KEY_URL.to_string()),
                uses_custom_provider_key: false,
                show_api_endpoint_selector: false,
                show_custom_model_composer: false,
                show_model_stats: true,
                supports_internet_access: false,
                supports_thinking: false,
                image_only: true,
            })
        );

        let worker_card = snapshot.services.iter().find(|item| item.id == "worker");
        assert_eq!(worker_card.map(|item| item.installed), Some(true));
        assert_eq!(
            worker_card.and_then(|item| item.settings_ui.as_deref()),
            Some("settings-ui/index.html")
        );
        assert_eq!(
            worker_card.and_then(|item| item.status.as_deref()),
            Some("stopped")
        );
        assert_eq!(snapshot.stars, vec!["openai"]);
    }

    #[test]
    fn catalog_snapshot_keeps_coming_soon_uninstalled_and_appends_discovered_integrations() {
        let mut future = module_item("future-image", "local");
        future.coming_soon = true;
        future.capabilities = vec!["image".to_string()];

        let snapshot = build_catalog_snapshot(
            app_config(vec![future], Vec::new()),
            vec![installed_module("discovered")],
            Vec::new(),
        );

        let future_card = snapshot.ai.iter().find(|item| item.id == "future-image");
        assert_eq!(future_card.map(|item| item.installed), Some(false));
        assert_eq!(
            future_card.and_then(|item| item.capability.as_deref()),
            Some("image")
        );

        let discovered = snapshot
            .services
            .iter()
            .find(|item| item.id == "discovered");
        assert_eq!(discovered.map(|item| item.installed), Some(true));
        assert_eq!(
            discovered.and_then(|item| item.name.as_deref()),
            Some("discovered title")
        );
        assert_eq!(discovered.and_then(|item| item.icon.as_deref()), Some("*"));
        assert_eq!(
            discovered.map(|item| item.category.as_str()),
            Some("services")
        );

        let custom_text = snapshot
            .ai
            .iter()
            .find(|item| item.id == CUSTOM_TEXT_PROVIDER_ID);
        assert_eq!(custom_text.map(|item| item.installed), Some(true));
        assert_eq!(
            custom_text
                .and_then(|item| item.provider_policy.as_ref())
                .map(|policy| (
                    policy.is_custom_provider,
                    policy.secret_service.as_deref(),
                    policy.show_api_endpoint_selector,
                    policy.show_model_stats,
                    policy.supports_internet_access,
                )),
            Some((true, Some("custom_text_api_key"), true, false, false))
        );
    }
}
