use crate::domain::monitoring as services;
use crate::errors::AppError;

#[tauri::command]
#[specta::specta]
/// Checks backend health status
pub fn get_health() -> Result<String, AppError> {
    Ok(services::health::check())
}

#[cfg(test)]
mod tests {
    use super::get_health;

    #[test]
    fn get_health_returns_ok_status() {
        let result = get_health();
        assert!(result.is_ok());
        let status = result.ok().unwrap_or_default();

        assert_eq!(status, "ok");
    }
}
