use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct Module {
    pub id: String,
    pub name: String,
    pub version: String,
    pub status: String,
}
