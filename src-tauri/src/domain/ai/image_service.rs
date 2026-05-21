use super::ai_dispatch::{LocalEngineAccess, normalize_session_id};
use super::ai_service::stop_conflicting_local_engine;
use super::image_cloud::{is_cloud_image_provider, process_cloud_image_request};
use super::image_comfyui::process_comfyui_request;
use super::image_local::process_local_image_request;
use super::image_provider_adapter::{ImageProviderRoute, route_for_image_provider};
use super::image_settings::apply_image_request_defaults;
use super::session::ChatSessionManager;
use super::types::{ChatMessage, ChatReply, ImageGenerationRequest, ImageGenerationResponse};
use crate::domain::ai::ImageGenerationState;
use crate::domain::engine::manager::EngineManager;
use crate::domain::engine::types::Capability;
use crate::errors::AppError;
use crate::infrastructure::config::settings::SettingsService;

pub(super) async fn process_image_request(
    request: ImageGenerationRequest,
    sessions: &ChatSessionManager,
    engine_manager: &EngineManager,
    image_generation_state: &ImageGenerationState,
    settings_service: &SettingsService,
) -> Result<ImageGenerationResponse, AppError> {
    process_image_request_with_local_engine_access(
        request,
        sessions,
        engine_manager,
        image_generation_state,
        settings_service,
        LocalEngineAccess::AutoStart,
    )
    .await
}

pub(super) async fn process_image_request_without_engine_autostart(
    request: ImageGenerationRequest,
    sessions: &ChatSessionManager,
    engine_manager: &EngineManager,
    image_generation_state: &ImageGenerationState,
    settings_service: &SettingsService,
) -> Result<ImageGenerationResponse, AppError> {
    process_image_request_with_local_engine_access(
        request,
        sessions,
        engine_manager,
        image_generation_state,
        settings_service,
        LocalEngineAccess::RequireRunning,
    )
    .await
}

async fn process_image_request_with_local_engine_access(
    request: ImageGenerationRequest,
    sessions: &ChatSessionManager,
    engine_manager: &EngineManager,
    image_generation_state: &ImageGenerationState,
    settings_service: &SettingsService,
    local_engine_access: LocalEngineAccess,
) -> Result<ImageGenerationResponse, AppError> {
    let request = apply_image_request_defaults(request, settings_service).await?;
    let images = {
        let _local_workload_guard = if is_cloud_image_provider(&request.provider) {
            None
        } else {
            Some(engine_manager.acquire_local_workload().await)
        };

        match route_for_image_provider(&request.provider) {
            ImageProviderRoute::ComfyUi => {
                stop_conflicting_local_engine(engine_manager, Capability::Image).await?;
                process_comfyui_request(&request, image_generation_state, settings_service).await?
            }
            ImageProviderRoute::CloudOpenRouter => process_cloud_image_request(&request).await?,
            ImageProviderRoute::Local(_) => {
                process_local_image_request(
                    &request,
                    engine_manager,
                    image_generation_state,
                    local_engine_access,
                )
                .await?
            }
        }
    };

    if let Some(session_id) = normalize_session_id(request.session_id.as_deref())
        && !images.is_empty()
    {
        let user_message = ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: "user".to_string(),
            content: serde_json::Value::String(
                request
                    .original_prompt
                    .clone()
                    .unwrap_or_else(|| request.prompt.clone()),
            ),
            thought_signature: None,
        };
        let _ = sessions.merge_request_messages(session_id, &[user_message]);

        let reply = ChatReply {
            text: String::new(),
            role: "assistant".to_string(),
        };

        sessions.append_response_with_content(
            session_id,
            uuid::Uuid::new_v4().to_string(),
            build_generated_image_content(&images),
            &reply.role,
            None,
        );
        if let Err(error) = sessions.force_save().await {
            tracing::warn!(
                session_id,
                image_count = images.len(),
                "Failed to persist generated image transcript: {error}"
            );
        }
    }

    Ok(ImageGenerationResponse {
        images,
        ok: true,
        error: None,
    })
}

fn build_generated_image_content(images: &[String]) -> serde_json::Value {
    serde_json::Value::Array(
        images
            .iter()
            .map(|image| {
                serde_json::json!({
                    "type": "image_url",
                    "image_url": {
                        "url": image
                    }
                })
            })
            .collect(),
    )
}
