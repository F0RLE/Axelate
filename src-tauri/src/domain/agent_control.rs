//! Trusted local agent profiles, scopes, audit entries, and approval requests.

use crate::errors::AppError;
use crate::infrastructure::persistence::json_store::JsonStore;
use crate::utils::paths::FILE_AGENT_CONTROL;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::collections::HashMap;
use std::sync::Arc;

const TOKEN_PREFIX_LEN: usize = 18;
const MAX_AUDIT_ENTRIES: usize = 200;
const MAX_APPROVAL_REQUESTS: usize = 100;

/// Agent capability scope.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "kebab-case")]
pub enum AgentScope {
    /// Read launcher state, statuses, inventories, and sanitized logs.
    Observe,
    /// Start, stop, restart, select, and inspect operational runtime state.
    Operate,
    /// Change non-secret launcher, module, model, and provider settings.
    Configure,
    /// Create integration drafts without installing or running them silently.
    DraftCreate,
    /// User-granted full local launcher access.
    FullAccess,
}

/// Public trusted local agent profile metadata.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    /// Stable profile id.
    pub id: String,
    /// User-facing agent name.
    pub name: String,
    /// Granted capability scopes.
    pub scopes: Vec<AgentScope>,
    /// Non-secret token prefix for recognition in the UI.
    pub token_prefix: String,
    /// Creation timestamp in RFC3339 UTC.
    pub created_at: String,
    /// Last successful API authentication timestamp in RFC3339 UTC.
    pub last_seen_at: Option<String>,
    /// Whether the profile has been revoked.
    pub revoked: bool,
}

/// Agent profile creation/rotation response. Raw bearer tokens stay backend-owned.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileTokenResponse {
    /// Public profile metadata.
    pub profile: AgentProfile,
}

/// Agent action audit entry.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuditEntry {
    /// Stable audit entry id.
    pub id: String,
    /// Agent profile id or launcher-env for development tokens.
    pub actor_id: String,
    /// Agent display name or development token label.
    pub actor_name: String,
    /// Action name such as module.start.
    pub action: String,
    /// Target resource id.
    pub target: String,
    /// Result label such as success, denied, or pending-approval.
    pub result: String,
    /// Timestamp in RFC3339 UTC.
    pub created_at: String,
}

/// Approval state for risky agent requests.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "kebab-case")]
pub enum AgentApprovalStatus {
    /// Waiting for a user decision.
    Pending,
    /// User approved the request.
    Approved,
    /// User denied the request.
    Denied,
}

/// Risky action request that must not mutate launcher state until approved.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalRequest {
    /// Stable approval request id.
    pub id: String,
    /// Agent profile id.
    pub agent_id: String,
    /// Agent display name.
    pub agent_name: String,
    /// Requested action name.
    pub action: String,
    /// Target resource id or description.
    pub target: String,
    /// Human-readable dry-run or diff summary.
    pub diff: String,
    /// Risk label such as high or dangerous.
    pub risk: String,
    /// Current decision state.
    pub status: AgentApprovalStatus,
    /// Creation timestamp in RFC3339 UTC.
    pub created_at: String,
    /// Decision timestamp in RFC3339 UTC.
    pub decided_at: Option<String>,
}

/// Full public Agent Control state for Settings UI.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentControlState {
    /// Whether trusted local agent profiles are accepted by the local API.
    pub enabled: bool,
    /// Local API base URL.
    pub api_base_url: String,
    /// Known agent profiles.
    pub profiles: Vec<AgentProfile>,
    /// Recent audit entries.
    pub audit: Vec<AgentAuditEntry>,
    /// Recent approval requests.
    pub approvals: Vec<AgentApprovalRequest>,
}

/// Authenticated agent identity from a bearer token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizedAgent {
    /// Profile id.
    pub id: String,
    /// Profile name.
    pub name: String,
    /// Granted scopes.
    pub scopes: Vec<AgentScope>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAgentProfile {
    id: String,
    name: String,
    scopes: Vec<AgentScope>,
    token_hash: String,
    token_prefix: String,
    created_at: String,
    last_seen_at: Option<String>,
    revoked: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentControlStore {
    enabled: bool,
    profiles: Vec<StoredAgentProfile>,
    audit: Vec<AgentAuditEntry>,
    approvals: Vec<AgentApprovalRequest>,
}

/// Backend-owned Agent Control persistence and authorization service.
#[derive(Debug, Clone)]
pub struct AgentControlService {
    json_store: JsonStore,
    lock: Arc<tokio::sync::Mutex<()>>,
    pending_tokens: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
}

impl AgentControlService {
    /// Creates a new service.
    pub fn new(json_store: JsonStore) -> Self {
        Self {
            json_store,
            lock: Arc::new(tokio::sync::Mutex::new(())),
            pending_tokens: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }

    /// Returns redacted Agent Control state for UI.
    pub async fn state(&self, api_base_url: String) -> Result<AgentControlState, AppError> {
        let _guard = self.lock.lock().await;
        let store = self.load_store_locked().await?;
        Ok(public_state(store, api_base_url))
    }

    /// Enables or disables trusted local agent profiles.
    pub async fn set_enabled(
        &self,
        enabled: bool,
        api_base_url: String,
    ) -> Result<AgentControlState, AppError> {
        let _guard = self.lock.lock().await;
        let mut store = self.load_store_locked().await?;
        store.enabled = enabled;
        self.save_store_locked(&store).await?;
        Ok(public_state(store, api_base_url))
    }

    /// Creates a trusted local agent profile and returns its one-time token.
    pub async fn create_profile(
        &self,
        name: Option<String>,
        scopes: Option<Vec<AgentScope>>,
    ) -> Result<AgentProfileTokenResponse, AppError> {
        let _guard = self.lock.lock().await;
        let mut store = self.load_store_locked().await?;
        let token = generate_agent_token();
        let now = now_rfc3339();
        let profile = StoredAgentProfile {
            id: uuid::Uuid::new_v4().to_string(),
            name: normalize_profile_name(name),
            scopes: normalize_scopes(scopes),
            token_hash: hash_token(&token),
            token_prefix: token_prefix(&token),
            created_at: now,
            last_seen_at: None,
            revoked: false,
        };
        let public_profile = public_profile(&profile);
        store.profiles.push(profile);
        store.enabled = true;
        self.save_store_locked(&store).await?;
        self.store_pending_token(public_profile.id.clone(), token)
            .await;

        Ok(AgentProfileTokenResponse {
            profile: public_profile,
        })
    }

    /// Rotates a profile token and returns the new one-time token.
    pub async fn rotate_profile(&self, id: &str) -> Result<AgentProfileTokenResponse, AppError> {
        let _guard = self.lock.lock().await;
        let mut store = self.load_store_locked().await?;
        let token = generate_agent_token();
        let Some(profile) = store.profiles.iter_mut().find(|profile| profile.id == id) else {
            return Err(AppError::NotFound(format!("Agent profile {id} not found")));
        };
        if profile.revoked {
            return Err(AppError::Validation(format!(
                "Agent profile {id} is revoked; create a new profile instead"
            )));
        }
        profile.token_hash = hash_token(&token);
        profile.token_prefix = token_prefix(&token);
        profile.last_seen_at = None;
        let public_profile = public_profile(profile);
        let profile_id = public_profile.id.clone();
        self.save_store_locked(&store).await?;
        self.store_pending_token(profile_id, token).await;

        Ok(AgentProfileTokenResponse {
            profile: public_profile,
        })
    }

    /// Revokes a profile token.
    pub async fn revoke_profile(
        &self,
        id: &str,
        api_base_url: String,
    ) -> Result<AgentControlState, AppError> {
        let _guard = self.lock.lock().await;
        let mut store = self.load_store_locked().await?;
        let Some(profile) = store.profiles.iter_mut().find(|profile| profile.id == id) else {
            return Err(AppError::NotFound(format!("Agent profile {id} not found")));
        };
        profile.revoked = true;
        self.pending_tokens.lock().await.remove(id);
        self.save_store_locked(&store).await?;
        Ok(public_state(store, api_base_url))
    }

    /// Deletes a trusted local agent profile and removes its pending approvals.
    pub async fn delete_profile(
        &self,
        id: &str,
        api_base_url: String,
    ) -> Result<AgentControlState, AppError> {
        let _guard = self.lock.lock().await;
        let mut store = self.load_store_locked().await?;
        let before = store.profiles.len();
        store.profiles.retain(|profile| profile.id != id);
        if store.profiles.len() == before {
            return Err(AppError::NotFound(format!("Agent profile {id} not found")));
        }
        store.approvals.retain(|approval| {
            approval.agent_id != id || approval.status != AgentApprovalStatus::Pending
        });
        self.pending_tokens.lock().await.remove(id);
        self.save_store_locked(&store).await?;
        Ok(public_state(store, api_base_url))
    }

    /// Takes the one-time plaintext token for backend-mediated copy flows.
    pub async fn take_pending_token(&self, id: &str) -> Result<String, AppError> {
        let Some(token) = self.pending_tokens.lock().await.remove(id) else {
            return Err(AppError::Validation(
                "No one-time token is available for this profile; rotate it to create a new token"
                    .to_string(),
            ));
        };
        Ok(token)
    }

    /// Authenticates a bearer token against enabled, non-revoked profiles.
    pub async fn authorize_token(&self, token: &str) -> Option<AuthorizedAgent> {
        let _guard = self.lock.lock().await;
        let mut store = self.load_store_locked().await.ok()?;
        if !store.enabled {
            return None;
        }

        let hash = hash_token(token);
        let profile = store
            .profiles
            .iter_mut()
            .find(|profile| !profile.revoked && profile.token_hash == hash)?;
        profile.last_seen_at = Some(now_rfc3339());
        let agent = AuthorizedAgent {
            id: profile.id.clone(),
            name: profile.name.clone(),
            scopes: profile.scopes.clone(),
        };
        let _ = self.save_store_locked(&store).await;
        Some(agent)
    }

    /// Records an agent audit entry.
    pub async fn record_audit(
        &self,
        actor_id: String,
        actor_name: String,
        action: String,
        target: String,
        result: String,
    ) -> Result<(), AppError> {
        let _guard = self.lock.lock().await;
        let mut store = self.load_store_locked().await?;
        store.audit.insert(
            0,
            AgentAuditEntry {
                id: uuid::Uuid::new_v4().to_string(),
                actor_id,
                actor_name,
                action,
                target,
                result,
                created_at: now_rfc3339(),
            },
        );
        store.audit.truncate(MAX_AUDIT_ENTRIES);
        self.save_store_locked(&store).await
    }

    /// Creates a pending approval request without mutating launcher state.
    pub async fn create_approval_request(
        &self,
        agent: &AuthorizedAgent,
        action: String,
        target: String,
        diff: String,
        risk: String,
    ) -> Result<AgentApprovalRequest, AppError> {
        let _guard = self.lock.lock().await;
        let mut store = self.load_store_locked().await?;
        let request = AgentApprovalRequest {
            id: uuid::Uuid::new_v4().to_string(),
            agent_id: agent.id.clone(),
            agent_name: agent.name.clone(),
            action,
            target,
            diff,
            risk,
            status: AgentApprovalStatus::Pending,
            created_at: now_rfc3339(),
            decided_at: None,
        };
        store.approvals.insert(0, request.clone());
        store.approvals.truncate(MAX_APPROVAL_REQUESTS);
        self.save_store_locked(&store).await?;
        Ok(request)
    }

    /// Applies a user decision to a pending approval request.
    pub async fn decide_approval(
        &self,
        id: &str,
        approved: bool,
        api_base_url: String,
    ) -> Result<AgentControlState, AppError> {
        let _guard = self.lock.lock().await;
        let mut store = self.load_store_locked().await?;
        let Some(request) = store.approvals.iter_mut().find(|request| request.id == id) else {
            return Err(AppError::NotFound(format!("Agent approval {id} not found")));
        };
        if request.status != AgentApprovalStatus::Pending {
            return Err(AppError::Validation(format!(
                "Agent approval {id} has already been decided"
            )));
        }
        request.status = if approved {
            AgentApprovalStatus::Approved
        } else {
            AgentApprovalStatus::Denied
        };
        request.decided_at = Some(now_rfc3339());
        self.save_store_locked(&store).await?;
        Ok(public_state(store, api_base_url))
    }

    async fn load_store_locked(&self) -> Result<AgentControlStore, AppError> {
        self.json_store.load_async(&FILE_AGENT_CONTROL).await
    }

    async fn save_store_locked(&self, store: &AgentControlStore) -> Result<(), AppError> {
        self.json_store.save_async(&FILE_AGENT_CONTROL, store).await
    }

    async fn store_pending_token(&self, id: String, token: String) {
        self.pending_tokens.lock().await.insert(id, token);
    }

    #[cfg(test)]
    async fn claim_pending_token_for_test(&self, id: &str) -> Result<String, AppError> {
        self.take_pending_token(id).await
    }
}

/// Returns the default Trusted Local scopes.
pub fn trusted_local_scopes() -> Vec<AgentScope> {
    vec![
        AgentScope::Observe,
        AgentScope::Operate,
        AgentScope::Configure,
        AgentScope::DraftCreate,
    ]
}

fn normalize_scopes(scopes: Option<Vec<AgentScope>>) -> Vec<AgentScope> {
    let mut scopes = scopes.unwrap_or_else(trusted_local_scopes);
    scopes.sort_by_key(|scope| scope_rank(*scope));
    scopes.dedup();
    if scopes.is_empty() {
        return trusted_local_scopes();
    }
    if scopes.contains(&AgentScope::FullAccess) {
        return vec![AgentScope::FullAccess];
    }
    scopes
}

const fn scope_rank(scope: AgentScope) -> u8 {
    match scope {
        AgentScope::Observe => 0,
        AgentScope::Operate => 1,
        AgentScope::Configure => 2,
        AgentScope::DraftCreate => 3,
        AgentScope::FullAccess => 4,
    }
}

fn normalize_profile_name(name: Option<String>) -> String {
    name.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Trusted Local".to_string())
}

fn generate_agent_token() -> String {
    format!(
        "axl_agent_{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

fn token_prefix(token: &str) -> String {
    token.chars().take(TOKEN_PREFIX_LEN).collect()
}

fn public_state(store: AgentControlStore, api_base_url: String) -> AgentControlState {
    AgentControlState {
        enabled: store.enabled,
        api_base_url,
        profiles: store.profiles.iter().map(public_profile).collect(),
        audit: store.audit,
        approvals: store.approvals,
    }
}

fn public_profile(profile: &StoredAgentProfile) -> AgentProfile {
    AgentProfile {
        id: profile.id.clone(),
        name: profile.name.clone(),
        scopes: profile.scopes.clone(),
        token_prefix: profile.token_prefix.clone(),
        created_at: profile.created_at.clone(),
        last_seen_at: profile.last_seen_at.clone(),
        revoked: profile.revoked,
    }
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::{AgentControlService, AgentScope};
    use crate::infrastructure::filesystem::local_file_service::LocalFileService;
    use crate::infrastructure::persistence::json_store::JsonStore;
    use crate::utils::paths::FILE_AGENT_CONTROL;
    use std::sync::Arc;

    static TEST_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

    fn service() -> AgentControlService {
        AgentControlService::new(JsonStore::new(Arc::new(LocalFileService::new())))
    }

    async fn reset_store() {
        let _ = tokio::fs::remove_file(&*FILE_AGENT_CONTROL).await;
    }

    #[tokio::test]
    async fn created_profile_returns_token_once_and_authorizes_when_enabled() {
        let _guard = TEST_LOCK.lock().await;
        reset_store().await;
        let service = service();
        let response = service
            .create_profile(Some("Codex".to_string()), None)
            .await
            .expect("profile");

        assert_eq!(response.profile.name, "Codex");
        assert!(response.profile.scopes.contains(&AgentScope::Observe));
        let token = service
            .claim_pending_token_for_test(&response.profile.id)
            .await
            .expect("pending token");
        assert!(token.starts_with("axl_agent_"));

        let authorized = service.authorize_token(&token).await.expect("authorized");
        assert_eq!(authorized.name, "Codex");
    }

    #[tokio::test]
    async fn take_pending_token_consumes_token() {
        let _guard = TEST_LOCK.lock().await;
        reset_store().await;
        let service = service();
        let response = service.create_profile(None, None).await.expect("profile");

        let first = service
            .take_pending_token(&response.profile.id)
            .await
            .expect("pending token");
        assert!(first.starts_with("axl_agent_"));
        assert!(
            service
                .take_pending_token(&response.profile.id)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn rotated_token_replaces_previous_pending_token() {
        let _guard = TEST_LOCK.lock().await;
        reset_store().await;
        let service = service();
        let response = service.create_profile(None, None).await.expect("profile");
        let rotated = service
            .rotate_profile(&response.profile.id)
            .await
            .expect("rotated profile");

        assert_eq!(rotated.profile.id, response.profile.id);
        let token = service
            .take_pending_token(&response.profile.id)
            .await
            .expect("pending token");
        assert!(service.authorize_token(&token).await.is_some());
    }

    #[tokio::test]
    async fn revoked_profile_cannot_authorize() {
        let _guard = TEST_LOCK.lock().await;
        reset_store().await;
        let service = service();
        let response = service.create_profile(None, None).await.expect("profile");

        service
            .revoke_profile(&response.profile.id, "http://127.0.0.1:3000".to_string())
            .await
            .expect("revoke");

        assert!(
            service
                .take_pending_token(&response.profile.id)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn revoked_profile_cannot_be_rotated_back_to_active() {
        let _guard = TEST_LOCK.lock().await;
        reset_store().await;
        let service = service();
        let response = service.create_profile(None, None).await.expect("profile");

        service
            .revoke_profile(&response.profile.id, "http://127.0.0.1:3000".to_string())
            .await
            .expect("revoke");

        assert!(service.rotate_profile(&response.profile.id).await.is_err());
    }

    #[tokio::test]
    async fn deleted_profile_is_removed_and_cannot_authorize() {
        let _guard = TEST_LOCK.lock().await;
        reset_store().await;
        let service = service();
        let response = service.create_profile(None, None).await.expect("profile");

        let state = service
            .delete_profile(&response.profile.id, "http://127.0.0.1:3000".to_string())
            .await
            .expect("delete");

        assert!(state.profiles.is_empty());
        assert!(
            service
                .take_pending_token(&response.profile.id)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn approval_decision_updates_status() {
        let _guard = TEST_LOCK.lock().await;
        reset_store().await;
        let service = service();
        let response = service.create_profile(None, None).await.expect("profile");
        let token = service
            .claim_pending_token_for_test(&response.profile.id)
            .await
            .expect("pending token");
        let agent = service.authorize_token(&token).await.expect("agent");
        let approval = service
            .create_approval_request(
                &agent,
                "package.install".to_string(),
                "demo".to_string(),
                "Install demo".to_string(),
                "dangerous".to_string(),
            )
            .await
            .expect("approval");

        let state = service
            .decide_approval(&approval.id, false, "http://127.0.0.1:3000".to_string())
            .await
            .expect("decision");

        assert_eq!(
            state.approvals.first().map(|item| &item.status),
            Some(&super::AgentApprovalStatus::Denied)
        );
    }

    #[tokio::test]
    async fn full_access_scope_replaces_narrow_scopes() {
        let _guard = TEST_LOCK.lock().await;
        reset_store().await;
        let service = service();
        let response = service
            .create_profile(
                Some("Full Access".to_string()),
                Some(vec![AgentScope::Observe, AgentScope::FullAccess]),
            )
            .await
            .expect("profile");

        assert_eq!(response.profile.scopes, vec![AgentScope::FullAccess]);
        let token = service
            .claim_pending_token_for_test(&response.profile.id)
            .await
            .expect("pending token");
        let authorized = service.authorize_token(&token).await.expect("authorized");
        assert_eq!(authorized.scopes, vec![AgentScope::FullAccess]);
    }

    #[tokio::test]
    async fn deleting_profile_keeps_decided_approval_history() {
        let _guard = TEST_LOCK.lock().await;
        reset_store().await;
        let service = service();
        let response = service.create_profile(None, None).await.expect("profile");
        let token = service
            .claim_pending_token_for_test(&response.profile.id)
            .await
            .expect("pending token");
        let agent = service.authorize_token(&token).await.expect("agent");
        let pending = service
            .create_approval_request(
                &agent,
                "package.install".to_string(),
                "pending-demo".to_string(),
                "Install pending demo".to_string(),
                "dangerous".to_string(),
            )
            .await
            .expect("pending approval");
        let decided = service
            .create_approval_request(
                &agent,
                "package.delete".to_string(),
                "decided-demo".to_string(),
                "Delete decided demo".to_string(),
                "dangerous".to_string(),
            )
            .await
            .expect("decided approval");

        service
            .decide_approval(&decided.id, true, "http://127.0.0.1:3000".to_string())
            .await
            .expect("decision");
        let state = service
            .delete_profile(&response.profile.id, "http://127.0.0.1:3000".to_string())
            .await
            .expect("delete");

        assert!(
            state
                .approvals
                .iter()
                .all(|approval| approval.id != pending.id)
        );
        assert!(
            state
                .approvals
                .iter()
                .any(|approval| approval.id == decided.id
                    && approval.status == super::AgentApprovalStatus::Approved)
        );
    }

    #[tokio::test]
    async fn decided_approval_cannot_be_changed() {
        let _guard = TEST_LOCK.lock().await;
        reset_store().await;
        let service = service();
        let response = service.create_profile(None, None).await.expect("profile");
        let token = service
            .claim_pending_token_for_test(&response.profile.id)
            .await
            .expect("pending token");
        let agent = service.authorize_token(&token).await.expect("agent");
        let approval = service
            .create_approval_request(
                &agent,
                "package.install".to_string(),
                "demo".to_string(),
                "Install demo".to_string(),
                "dangerous".to_string(),
            )
            .await
            .expect("approval");

        service
            .decide_approval(&approval.id, false, "http://127.0.0.1:3000".to_string())
            .await
            .expect("first decision");

        assert!(
            service
                .decide_approval(&approval.id, true, "http://127.0.0.1:3000".to_string())
                .await
                .is_err()
        );
    }
}
