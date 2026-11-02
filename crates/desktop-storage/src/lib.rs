use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

const DATABASE_VERSION: i64 = 1;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("SQLite workspace error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Workspace JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Invalid document: {0}")]
    InvalidDocument(String),
    #[error("Workspace database lock was poisoned")]
    Poisoned,
    #[error("Workspace database version {0} is newer than this application supports")]
    UnsupportedVersion(i64),
}

pub type StorageResult<T> = Result<T, StorageError>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredDocument {
    pub id: String,
    pub name: String,
    pub diagram_type: String,
    pub schema_version: i64,
    pub document: Value,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    pub favorite: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trashed_at: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub id: String,
    pub document_id: String,
    pub document: Value,
    pub saved_at: i64,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshot {
    pub id: String,
    pub document: Value,
    pub saved_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalTemplate {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub document: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub id: String,
    pub name: String,
    pub diagram_type: String,
    pub schema_version: i64,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    pub favorite: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trashed_at: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceExportSnapshot {
    pub documents: Vec<StoredDocument>,
    pub snapshots: Vec<DocumentSnapshot>,
    pub recovery: Vec<RecoverySnapshot>,
    pub templates: Vec<LocalTemplate>,
    pub preferences: Vec<(String, String)>,
}

/// A serialized SQLite connection. Tauri commands should call it from a
/// blocking worker so synchronous SQLite work never occupies the webview UI.
pub struct WorkspaceDb {
    connection: Mutex<Connection>,
}

impl WorkspaceDb {
    pub fn open(path: impl AsRef<Path>) -> StorageResult<Self> {
        let connection = Connection::open(path)?;
        Self::initialize(connection)
    }

    pub fn open_in_memory() -> StorageResult<Self> {
        Self::initialize(Connection::open_in_memory()?)
    }

    fn initialize(connection: Connection) -> StorageResult<Self> {
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn save_document(
        &self,
        document: Value,
        thumbnail: Option<&str>,
    ) -> StorageResult<StoredDocument> {
        self.save_document_with_thumbnail(document, thumbnail, false)
    }

    pub fn save_document_with_thumbnail(
        &self,
        document: Value,
        thumbnail: Option<&str>,
        clear_thumbnail: bool,
    ) -> StorageResult<StoredDocument> {
        let metadata = DocumentSummary::from_document(&document)?;
        let serialized = serde_json::to_string(&document)?;
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let existing = read_document(&connection, &metadata.id)?;
        let thumbnail = if clear_thumbnail {
            None
        } else {
            thumbnail.map(str::to_owned).or_else(|| {
                existing
                    .as_ref()
                    .and_then(|record| record.thumbnail.clone())
            })
        };
        let favorite = existing.as_ref().is_some_and(|record| record.favorite);
        let trashed_at = existing.as_ref().and_then(|record| record.trashed_at);
        connection.execute(
            "INSERT INTO documents (id, name, diagram_type, schema_version, document_json, created_at, updated_at, thumbnail, favorite, trashed_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, diagram_type=excluded.diagram_type, \
               schema_version=excluded.schema_version, document_json=excluded.document_json, \
               created_at=excluded.created_at, updated_at=excluded.updated_at, thumbnail=excluded.thumbnail",
            params![metadata.id, metadata.name, metadata.diagram_type, metadata.schema_version, serialized, metadata.created_at, metadata.updated_at, thumbnail, favorite, trashed_at],
        )?;
        Ok(StoredDocument {
            id: metadata.id,
            name: metadata.name,
            diagram_type: metadata.diagram_type,
            schema_version: metadata.schema_version,
            document,
            created_at: metadata.created_at,
            updated_at: metadata.updated_at,
            thumbnail,
            favorite,
            trashed_at,
        })
    }

    pub fn load_document(&self, id: &str) -> StorageResult<Option<StoredDocument>> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        read_document(&connection, id)
    }

    pub fn list_documents(&self, include_trashed: bool) -> StorageResult<Vec<StoredDocument>> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let query = if include_trashed {
            "SELECT id, name, diagram_type, schema_version, document_json, created_at, updated_at, thumbnail, favorite, trashed_at FROM documents ORDER BY updated_at DESC"
        } else {
            "SELECT id, name, diagram_type, schema_version, document_json, created_at, updated_at, thumbnail, favorite, trashed_at FROM documents WHERE trashed_at IS NULL ORDER BY updated_at DESC"
        };
        let mut statement = connection.prepare(query)?;
        let rows = statement.query_map([], read_document_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StorageError::from)
    }

    pub fn list_document_summaries(
        &self,
        include_trashed: bool,
    ) -> StorageResult<Vec<DocumentSummary>> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let query = if include_trashed {
            "SELECT id, name, diagram_type, schema_version, created_at, updated_at, thumbnail, favorite, trashed_at FROM documents ORDER BY updated_at DESC"
        } else {
            "SELECT id, name, diagram_type, schema_version, created_at, updated_at, thumbnail, favorite, trashed_at FROM documents WHERE trashed_at IS NULL ORDER BY updated_at DESC"
        };
        let mut statement = connection.prepare(query)?;
        let rows = statement.query_map([], |row| {
            Ok(DocumentSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                diagram_type: row.get(2)?,
                schema_version: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                thumbnail: row.get(6)?,
                favorite: row.get(7)?,
                trashed_at: row.get(8)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StorageError::from)
    }

    pub fn list_document_summaries_with_trash(
        &self,
        include_trashed: bool,
    ) -> StorageResult<Vec<DocumentSummary>> {
        self.list_document_summaries(include_trashed)
    }

    pub fn update_document_metadata(
        &self,
        id: &str,
        favorite: Option<bool>,
        trashed_at: Option<Option<i64>>,
    ) -> StorageResult<bool> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        if let Some(favorite) = favorite {
            connection.execute(
                "UPDATE documents SET favorite=?2 WHERE id=?1",
                params![id, favorite],
            )?;
        }
        if let Some(trashed_at) = trashed_at {
            connection.execute(
                "UPDATE documents SET trashed_at=?2 WHERE id=?1",
                params![id, trashed_at],
            )?;
        }
        Ok(connection.changes() > 0)
    }

    pub fn save_document_thumbnail(
        &self,
        id: &str,
        revision: i64,
        thumbnail: &str,
    ) -> StorageResult<bool> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let changed = connection.execute(
            "UPDATE documents SET thumbnail=?3 WHERE id=?1 AND updated_at=?2",
            params![id, revision, thumbnail],
        )?;
        Ok(changed > 0)
    }

    pub fn clear_document_thumbnail(&self, id: &str, revision: i64) -> StorageResult<bool> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let changed = connection.execute(
            "UPDATE documents SET thumbnail=NULL WHERE id=?1 AND updated_at=?2",
            params![id, revision],
        )?;
        Ok(changed > 0)
    }

    pub fn rename_document(
        &self,
        id: &str,
        name: &str,
        updated_at: i64,
    ) -> StorageResult<Option<StoredDocument>> {
        let Some(existing) = self.load_document(id)? else {
            return Ok(None);
        };
        let mut document = existing.document;
        let object = document
            .as_object_mut()
            .ok_or_else(|| StorageError::InvalidDocument("root must be an object".into()))?;
        object.insert("name".into(), Value::String(name.trim().to_owned()));
        object.insert("updatedAt".into(), Value::from(updated_at));
        let mut saved = self.save_document(document, existing.thumbnail.as_deref())?;
        saved.favorite = existing.favorite;
        saved.trashed_at = existing.trashed_at;
        self.update_document_metadata(id, Some(saved.favorite), Some(saved.trashed_at))?;
        Ok(Some(saved))
    }

    pub fn duplicate_document(
        &self,
        id: &str,
        new_id: &str,
        now: i64,
    ) -> StorageResult<Option<StoredDocument>> {
        let Some(existing) = self.load_document(id)? else {
            return Ok(None);
        };
        let mut document = existing.document;
        let object = document
            .as_object_mut()
            .ok_or_else(|| StorageError::InvalidDocument("root must be an object".into()))?;
        object.insert("id".into(), Value::String(new_id.to_owned()));
        object.insert(
            "name".into(),
            Value::String(format!("{} copy", existing.name)),
        );
        object.insert("createdAt".into(), Value::from(now));
        object.insert("updatedAt".into(), Value::from(now));
        self.save_document(document, None).map(Some)
    }

    pub fn delete_document(&self, id: &str) -> StorageResult<()> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        connection.execute("DELETE FROM recovery WHERE document_id=?1", [id])?;
        connection.execute("DELETE FROM documents WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn clear_documents_and_history(&self) -> StorageResult<()> {
        let mut connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let transaction = connection.transaction()?;
        transaction.execute("DELETE FROM documents", [])?;
        transaction.execute("DELETE FROM snapshots", [])?;
        transaction.execute("DELETE FROM recovery", [])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn restore_workspace_data(
        &self,
        documents: Vec<StoredDocument>,
        snapshots: Vec<DocumentSnapshot>,
        recovery: Vec<RecoverySnapshot>,
        templates: Vec<LocalTemplate>,
        preferences: Vec<(String, String)>,
        replace: bool,
    ) -> StorageResult<()> {
        let prepared_documents = documents
            .into_iter()
            .map(prepare_stored_document)
            .collect::<StorageResult<Vec<_>>>()?;
        let prepared_snapshots = snapshots
            .into_iter()
            .map(prepare_snapshot)
            .collect::<StorageResult<Vec<_>>>()?;
        let prepared_templates = templates
            .into_iter()
            .map(prepare_template)
            .collect::<StorageResult<Vec<_>>>()?;
        let prepared_recovery = recovery
            .into_iter()
            .map(|snapshot| {
                let metadata = DocumentSummary::from_document(&snapshot.document)?;
                Ok::<_, StorageError>((
                    metadata.id,
                    serde_json::to_string(&snapshot.document)?,
                    snapshot.saved_at,
                ))
            })
            .collect::<StorageResult<Vec<_>>>()?;

        let mut connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let transaction = connection.transaction()?;
        if replace {
            transaction.execute("DELETE FROM snapshots", [])?;
            transaction.execute("DELETE FROM recovery", [])?;
            transaction.execute("DELETE FROM documents", [])?;
            transaction.execute("DELETE FROM templates", [])?;
            transaction.execute("DELETE FROM preferences", [])?;
        }
        for (record, serialized) in prepared_documents {
            transaction.execute(
                "INSERT INTO documents (id, name, diagram_type, schema_version, document_json, created_at, updated_at, thumbnail, favorite, trashed_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name, diagram_type=excluded.diagram_type, schema_version=excluded.schema_version, \
                   document_json=excluded.document_json, created_at=excluded.created_at, updated_at=excluded.updated_at, \
                   thumbnail=excluded.thumbnail, favorite=excluded.favorite, trashed_at=excluded.trashed_at",
                params![record.id, record.name, record.diagram_type, record.schema_version, serialized, record.created_at, record.updated_at, record.thumbnail, record.favorite, record.trashed_at],
            )?;
        }
        for (snapshot, serialized) in prepared_snapshots {
            transaction.execute(
                "INSERT INTO snapshots (id, document_id, document_json, saved_at, kind, name) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
                 ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id, document_json=excluded.document_json, saved_at=excluded.saved_at, kind=excluded.kind, name=excluded.name",
                params![snapshot.id, snapshot.document_id, serialized, snapshot.saved_at, snapshot.kind, snapshot.name],
            )?;
        }
        for (template, serialized) in prepared_templates {
            transaction.execute(
                "INSERT INTO templates (id, name, created_at, document_json) VALUES (?1, ?2, ?3, ?4) \
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name, created_at=excluded.created_at, document_json=excluded.document_json",
                params![template.id, template.name, template.created_at, serialized],
            )?;
        }
        for (key, value) in preferences {
            if !key.starts_with("aperglyph.")
                || key.starts_with("aperglyph.mcp.")
                || key == "aperglyph.local-templates"
                || key.len() > 256
                || value.len() > 200_000
            {
                continue;
            }
            transaction.execute(
                "INSERT INTO preferences (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![key, value],
            )?;
        }
        for (document_id, serialized, saved_at) in prepared_recovery {
            transaction.execute(
                "INSERT INTO recovery (document_id, document_json, saved_at) VALUES (?1, ?2, ?3) \
                 ON CONFLICT(document_id) DO UPDATE SET document_json=excluded.document_json, saved_at=excluded.saved_at",
                params![document_id, serialized, saved_at],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Read every backup component from a single SQLite read transaction so
    /// an export cannot combine documents and metadata from different save
    /// revisions.
    pub fn export_workspace_snapshot(&self) -> StorageResult<WorkspaceExportSnapshot> {
        let mut connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let transaction = connection.transaction()?;

        let documents = {
            let mut statement = transaction.prepare(
                "SELECT id, name, diagram_type, schema_version, document_json, created_at, updated_at, thumbnail, favorite, trashed_at FROM documents ORDER BY updated_at DESC",
            )?;
            let rows = statement.query_map([], read_document_row)?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let snapshots = {
            let mut statement = transaction.prepare(
                "SELECT id, document_id, document_json, saved_at, kind, name FROM snapshots ORDER BY saved_at DESC",
            )?;
            let rows = statement.query_map([], read_snapshot_row)?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let recovery = {
            let mut statement = transaction.prepare(
                "SELECT document_id, document_json, saved_at FROM recovery ORDER BY saved_at DESC",
            )?;
            let rows = statement.query_map([], |row| {
                let (id, document, saved_at) = read_recovery_row(row)?;
                Ok(RecoverySnapshot {
                    id: format!("recovery-{id}"),
                    document,
                    saved_at,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let templates = {
            let mut statement = transaction.prepare(
                "SELECT id, name, created_at, document_json FROM templates ORDER BY created_at DESC LIMIT 100",
            )?;
            let rows = statement.query_map([], |row| {
                let serialized: String = row.get(3)?;
                Ok(LocalTemplate {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    document: serde_json::from_str(&serialized).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            3,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let preferences = {
            let mut statement = transaction.prepare(
                "SELECT key, value FROM preferences WHERE key LIKE 'aperglyph.%' \
                 AND key NOT LIKE 'aperglyph.mcp.%' AND key!='aperglyph.local-templates' ORDER BY key",
            )?;
            let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        transaction.commit()?;
        Ok(WorkspaceExportSnapshot {
            documents,
            snapshots,
            recovery,
            templates,
            preferences,
        })
    }

    pub fn save_snapshot(&self, snapshot: &DocumentSnapshot, limit: usize) -> StorageResult<()> {
        let serialized = serde_json::to_string(&snapshot.document)?;
        let mut connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO snapshots (id, document_id, document_json, saved_at, kind, name) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
             ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id, document_json=excluded.document_json, saved_at=excluded.saved_at, kind=excluded.kind, name=excluded.name",
            params![snapshot.id, snapshot.document_id, serialized, snapshot.saved_at, snapshot.kind, snapshot.name],
        )?;
        prune_snapshots(&transaction, &snapshot.document_id, limit.max(1))?;
        transaction.commit()?;
        Ok(())
    }

    pub fn list_snapshots(
        &self,
        document_id: Option<&str>,
    ) -> StorageResult<Vec<DocumentSnapshot>> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let query = if document_id.is_some() {
            "SELECT id, document_id, document_json, saved_at, kind, name FROM snapshots WHERE document_id=?1 ORDER BY saved_at DESC"
        } else {
            "SELECT id, document_id, document_json, saved_at, kind, name FROM snapshots ORDER BY saved_at DESC"
        };
        let mut statement = connection.prepare(query)?;
        let mut snapshots = Vec::new();
        if let Some(document_id) = document_id {
            let rows = statement.query_map([document_id], read_snapshot_row)?;
            snapshots.extend(rows.collect::<Result<Vec<_>, _>>()?);
        } else {
            let rows = statement.query_map([], read_snapshot_row)?;
            snapshots.extend(rows.collect::<Result<Vec<_>, _>>()?);
        }
        Ok(snapshots)
    }

    pub fn load_snapshot(&self, id: &str) -> StorageResult<Option<DocumentSnapshot>> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        connection
            .query_row(
                "SELECT id, document_id, document_json, saved_at, kind, name FROM snapshots WHERE id=?1",
                [id],
                read_snapshot_row,
            )
            .optional()
            .map_err(StorageError::from)
    }

    pub fn delete_snapshot(&self, id: &str) -> StorageResult<()> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        connection.execute("DELETE FROM snapshots WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn clear_snapshots(&self) -> StorageResult<()> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        connection.execute("DELETE FROM snapshots", [])?;
        Ok(())
    }

    pub fn save_recovery(&self, document: Value, saved_at: i64) -> StorageResult<()> {
        let metadata = DocumentSummary::from_document(&document)?;
        let serialized = serde_json::to_string(&document)?;
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        connection.execute(
            "INSERT INTO recovery (document_id, document_json, saved_at) VALUES (?1, ?2, ?3) \
             ON CONFLICT(document_id) DO UPDATE SET document_json=excluded.document_json, saved_at=excluded.saved_at \
             WHERE excluded.saved_at > recovery.saved_at",
            params![metadata.id, serialized, saved_at],
        )?;
        Ok(())
    }

    pub fn get_recovery(
        &self,
        document_id: Option<&str>,
    ) -> StorageResult<Option<RecoverySnapshot>> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let query = if document_id.is_some() {
            "SELECT document_id, document_json, saved_at FROM recovery WHERE document_id=?1"
        } else {
            "SELECT document_id, document_json, saved_at FROM recovery ORDER BY saved_at DESC LIMIT 1"
        };
        let row = if let Some(document_id) = document_id {
            connection
                .query_row(query, [document_id], read_recovery_row)
                .optional()?
        } else {
            connection
                .query_row(query, [], read_recovery_row)
                .optional()?
        };
        Ok(row.map(|(id, document, saved_at)| RecoverySnapshot {
            id: format!("recovery-{id}"),
            document,
            saved_at,
        }))
    }

    pub fn list_recovery(&self) -> StorageResult<Vec<RecoverySnapshot>> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let mut statement = connection.prepare(
            "SELECT document_id, document_json, saved_at FROM recovery ORDER BY saved_at DESC",
        )?;
        let rows = statement.query_map([], |row| {
            let (id, document, saved_at) = read_recovery_row(row)?;
            Ok(RecoverySnapshot {
                id: format!("recovery-{id}"),
                document,
                saved_at,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StorageError::from)
    }

    pub fn clear_recovery(&self, document_id: Option<&str>) -> StorageResult<()> {
        self.clear_recovery_before(document_id, None)
    }

    pub fn clear_recovery_before(
        &self,
        document_id: Option<&str>,
        saved_before_or_at: Option<i64>,
    ) -> StorageResult<()> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        match (document_id, saved_before_or_at) {
            (Some(document_id), Some(timestamp)) => {
                connection.execute(
                    "DELETE FROM recovery WHERE document_id=?1 AND saved_at<=?2",
                    params![document_id, timestamp],
                )?;
            }
            (Some(document_id), None) => {
                connection.execute("DELETE FROM recovery WHERE document_id=?1", [document_id])?;
            }
            (None, Some(timestamp)) => {
                connection.execute("DELETE FROM recovery WHERE saved_at<=?1", [timestamp])?;
            }
            (None, None) => {
                connection.execute("DELETE FROM recovery", [])?;
            }
        }
        Ok(())
    }

    pub fn save_template(&self, template: &LocalTemplate) -> StorageResult<()> {
        let serialized = serde_json::to_string(&template.document)?;
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        connection.execute(
            "INSERT INTO templates (id, name, created_at, document_json) VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, created_at=excluded.created_at, document_json=excluded.document_json",
            params![template.id, template.name, template.created_at, serialized],
        )?;
        Ok(())
    }

    pub fn list_templates(&self) -> StorageResult<Vec<LocalTemplate>> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let mut statement = connection.prepare("SELECT id, name, created_at, document_json FROM templates ORDER BY created_at DESC LIMIT 100")?;
        let rows = statement.query_map([], |row| {
            let serialized: String = row.get(3)?;
            Ok(LocalTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                document: serde_json::from_str(&serialized).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        3,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StorageError::from)
    }

    pub fn delete_template(&self, id: &str) -> StorageResult<()> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        connection.execute("DELETE FROM templates WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn set_preference(&self, key: &str, value: &str) -> StorageResult<()> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        connection.execute(
            "INSERT INTO preferences (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_preference(&self, key: &str) -> StorageResult<Option<String>> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        connection
            .query_row("SELECT value FROM preferences WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(StorageError::from)
    }

    pub fn list_preferences(&self) -> StorageResult<Vec<(String, String)>> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let mut statement = connection.prepare(
            "SELECT key, value FROM preferences WHERE key LIKE 'aperglyph.%' \
             AND key NOT LIKE 'aperglyph.mcp.%' AND key!='aperglyph.local-templates' ORDER BY key",
        )?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StorageError::from)
    }

    pub fn delete_preference(&self, key: &str) -> StorageResult<()> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        connection.execute("DELETE FROM preferences WHERE key=?1", [key])?;
        Ok(())
    }

    pub fn storage_usage(&self) -> StorageResult<u64> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        let page_count: i64 =
            connection.pragma_query_value(None, "page_count", |row| row.get(0))?;
        let page_size: i64 = connection.pragma_query_value(None, "page_size", |row| row.get(0))?;
        let pages = u64::try_from(page_count.max(0)).unwrap_or(0);
        let bytes_per_page = u64::try_from(page_size.max(0)).unwrap_or(0);
        Ok(pages.saturating_mul(bytes_per_page))
    }

    pub fn checkpoint(&self) -> StorageResult<()> {
        let connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        connection.execute_batch("PRAGMA wal_checkpoint(FULL);")?;
        Ok(())
    }
}

impl DocumentSummary {
    pub fn from_document(document: &Value) -> StorageResult<Self> {
        let object = document
            .as_object()
            .ok_or_else(|| StorageError::InvalidDocument("root must be an object".into()))?;
        Ok(Self {
            id: required_string(object, "id")?,
            name: required_string(object, "name")?,
            diagram_type: required_string(object, "diagramType")?,
            schema_version: required_integer(object, "schemaVersion")?,
            created_at: required_integer(object, "createdAt")?,
            updated_at: required_integer(object, "updatedAt")?,
            thumbnail: None,
            favorite: false,
            trashed_at: None,
        })
    }
}

fn required_string(object: &Map<String, Value>, key: &str) -> StorageResult<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| StorageError::InvalidDocument(format!("{key} must be a non-empty string")))
}

fn required_integer(object: &Map<String, Value>, key: &str) -> StorageResult<i64> {
    object
        .get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| StorageError::InvalidDocument(format!("{key} must be an integer")))
}

fn migrate(connection: &Connection) -> StorageResult<()> {
    let current: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if current > DATABASE_VERSION {
        return Err(StorageError::UnsupportedVersion(current));
    }
    if current < 1 {
        connection.execute_batch(
            "BEGIN IMMEDIATE;
             CREATE TABLE documents (
               id TEXT PRIMARY KEY NOT NULL,
               name TEXT NOT NULL,
               diagram_type TEXT NOT NULL,
               schema_version INTEGER NOT NULL,
               document_json TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL,
               thumbnail TEXT,
               favorite INTEGER NOT NULL DEFAULT 0,
               trashed_at INTEGER
             );
             CREATE INDEX documents_updated_at ON documents(updated_at DESC);
             CREATE INDEX documents_trashed_at ON documents(trashed_at);
             CREATE TABLE snapshots (
               id TEXT PRIMARY KEY NOT NULL,
               document_id TEXT NOT NULL,
               document_json TEXT NOT NULL,
               saved_at INTEGER NOT NULL,
               kind TEXT NOT NULL CHECK(kind IN ('automatic', 'checkpoint')),
               name TEXT,
               FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
             );
             CREATE INDEX snapshots_document_saved ON snapshots(document_id, saved_at DESC);
             CREATE TABLE recovery (
               document_id TEXT PRIMARY KEY NOT NULL,
               document_json TEXT NOT NULL,
               saved_at INTEGER NOT NULL
             );
             CREATE INDEX recovery_saved_at ON recovery(saved_at DESC);
             CREATE TABLE templates (
               id TEXT PRIMARY KEY NOT NULL,
               name TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               document_json TEXT NOT NULL
             );
             CREATE INDEX templates_created_at ON templates(created_at DESC);
             CREATE TABLE preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
             PRAGMA user_version=1;
             COMMIT;",
        )?;
    }
    Ok(())
}

fn read_document(connection: &Connection, id: &str) -> StorageResult<Option<StoredDocument>> {
    connection
        .query_row(
            "SELECT id, name, diagram_type, schema_version, document_json, created_at, updated_at, thumbnail, favorite, trashed_at FROM documents WHERE id=?1",
            [id],
            read_document_row,
        )
        .optional()
        .map_err(StorageError::from)
}

fn read_document_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredDocument> {
    let serialized: String = row.get(4)?;
    let document = serde_json::from_str(&serialized).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(StoredDocument {
        id: row.get(0)?,
        name: row.get(1)?,
        diagram_type: row.get(2)?,
        schema_version: row.get(3)?,
        document,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        thumbnail: row.get(7)?,
        favorite: row.get(8)?,
        trashed_at: row.get(9)?,
    })
}

fn read_snapshot_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DocumentSnapshot> {
    let serialized: String = row.get(2)?;
    let document = serde_json::from_str(&serialized).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(DocumentSnapshot {
        id: row.get(0)?,
        document_id: row.get(1)?,
        document,
        saved_at: row.get(3)?,
        kind: row.get(4)?,
        name: row.get(5)?,
    })
}

fn read_recovery_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, Value, i64)> {
    let serialized: String = row.get(1)?;
    let document = serde_json::from_str(&serialized).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok((row.get(0)?, document, row.get(2)?))
}

fn prepare_stored_document(record: StoredDocument) -> StorageResult<(StoredDocument, String)> {
    let metadata = DocumentSummary::from_document(&record.document)?;
    if record.id != metadata.id
        || record.name != metadata.name
        || record.diagram_type != metadata.diagram_type
        || record.schema_version != metadata.schema_version
        || record.created_at != metadata.created_at
        || record.updated_at != metadata.updated_at
    {
        return Err(StorageError::InvalidDocument(
            "workspace metadata does not match the stored document".into(),
        ));
    }
    let serialized = serde_json::to_string(&record.document)?;
    Ok((record, serialized))
}

fn prepare_snapshot(snapshot: DocumentSnapshot) -> StorageResult<(DocumentSnapshot, String)> {
    let metadata = DocumentSummary::from_document(&snapshot.document)?;
    if snapshot.document_id != metadata.id
        || (snapshot.kind != "automatic" && snapshot.kind != "checkpoint")
    {
        return Err(StorageError::InvalidDocument(
            "snapshot metadata is invalid".into(),
        ));
    }
    let serialized = serde_json::to_string(&snapshot.document)?;
    Ok((snapshot, serialized))
}

fn prepare_template(template: LocalTemplate) -> StorageResult<(LocalTemplate, String)> {
    if template.id.trim().is_empty() || template.name.trim().is_empty() {
        return Err(StorageError::InvalidDocument(
            "template ID and name are required".into(),
        ));
    }
    DocumentSummary::from_document(&template.document)?;
    let serialized = serde_json::to_string(&template.document)?;
    Ok((template, serialized))
}

fn prune_snapshots(
    transaction: &Transaction<'_>,
    document_id: &str,
    limit: usize,
) -> StorageResult<()> {
    transaction.execute(
        "DELETE FROM snapshots WHERE document_id=?1 AND id NOT IN (
           SELECT id FROM snapshots WHERE document_id=?1
           ORDER BY CASE kind WHEN 'checkpoint' THEN 0 ELSE 1 END, saved_at DESC LIMIT ?2
         )",
        params![document_id, limit as i64],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn document(id: &str, updated_at: i64) -> Value {
        json!({
            "schemaVersion": 1,
            "id": id,
            "name": format!("Diagram {id}"),
            "diagramType": "erd",
            "pages": [],
            "palette": [],
            "stylePresets": [],
            "styleDefaults": {},
            "createdAt": 10,
            "updatedAt": updated_at
        })
    }

    #[test]
    fn persists_documents_and_lightweight_summaries() {
        let database = WorkspaceDb::open_in_memory().unwrap();
        let saved = database
            .save_document(document("one", 20), Some("thumbnail"))
            .unwrap();
        assert_eq!(database.load_document("one").unwrap(), Some(saved.clone()));
        assert_eq!(
            database.list_document_summaries(false).unwrap(),
            vec![DocumentSummary {
                id: saved.id,
                name: saved.name,
                diagram_type: saved.diagram_type,
                schema_version: saved.schema_version,
                created_at: saved.created_at,
                updated_at: saved.updated_at,
                thumbnail: saved.thumbnail,
                favorite: false,
                trashed_at: None,
            }]
        );
    }

    #[test]
    fn saving_without_a_thumbnail_clears_it_only_when_requested() {
        let database = WorkspaceDb::open_in_memory().unwrap();
        database
            .save_document(document("thumb", 20), Some("old-thumbnail"))
            .unwrap();
        let retained = database.save_document(document("thumb", 21), None).unwrap();
        assert_eq!(retained.thumbnail.as_deref(), Some("old-thumbnail"));
        let cleared = database
            .save_document_with_thumbnail(document("thumb", 22), None, true)
            .unwrap();
        assert_eq!(cleared.thumbnail, None);
        assert_eq!(database.load_document("thumb").unwrap(), Some(cleared));
    }

    #[test]
    fn metadata_updates_and_trash_queries_do_not_rewrite_documents() {
        let database = WorkspaceDb::open_in_memory().unwrap();
        database.save_document(document("one", 20), None).unwrap();
        database
            .update_document_metadata("one", Some(true), Some(Some(30)))
            .unwrap();
        assert!(database.list_documents(false).unwrap().is_empty());
        let trashed = database.list_documents(true).unwrap();
        assert!(trashed[0].favorite);
        assert_eq!(trashed[0].trashed_at, Some(30));
        database
            .update_document_metadata("one", None, Some(None))
            .unwrap();
        assert_eq!(database.list_documents(false).unwrap().len(), 1);
    }

    #[test]
    fn snapshots_are_bounded_and_recovery_is_per_document() {
        let database = WorkspaceDb::open_in_memory().unwrap();
        database.save_document(document("one", 20), None).unwrap();
        database.save_document(document("two", 20), None).unwrap();
        for index in 1..=3 {
            database
                .save_snapshot(
                    &DocumentSnapshot {
                        id: format!("automatic-{index}"),
                        document_id: "one".into(),
                        document: document("one", index),
                        saved_at: index,
                        kind: "automatic".into(),
                        name: None,
                    },
                    2,
                )
                .unwrap();
        }
        database
            .save_snapshot(
                &DocumentSnapshot {
                    id: "checkpoint".into(),
                    document_id: "one".into(),
                    document: document("one", 4),
                    saved_at: 4,
                    kind: "checkpoint".into(),
                    name: Some("Before edits".into()),
                },
                2,
            )
            .unwrap();
        let snapshots = database.list_snapshots(Some("one")).unwrap();
        assert_eq!(snapshots.len(), 2);
        assert!(
            snapshots
                .iter()
                .any(|snapshot| snapshot.kind == "checkpoint")
        );

        database.save_recovery(document("one", 10), 11).unwrap();
        database.save_recovery(document("two", 12), 13).unwrap();
        assert_eq!(
            database
                .get_recovery(Some("one"))
                .unwrap()
                .unwrap()
                .saved_at,
            11
        );
        assert_eq!(database.get_recovery(None).unwrap().unwrap().saved_at, 13);
    }

    #[test]
    fn workspace_export_captures_documents_history_preferences_and_recovery_together() {
        let database = WorkspaceDb::open_in_memory().unwrap();
        let saved = database
            .save_document(document("exported", 20), None)
            .unwrap();
        database
            .update_document_metadata("exported", Some(true), Some(Some(30)))
            .unwrap();
        database
            .save_snapshot(
                &DocumentSnapshot {
                    id: "exported-snapshot".into(),
                    document_id: "exported".into(),
                    document: saved.document.clone(),
                    saved_at: 31,
                    kind: "checkpoint".into(),
                    name: Some("Before export".into()),
                },
                31,
            )
            .unwrap();
        database
            .save_recovery(document("recovery", 32), 33)
            .unwrap();
        database
            .save_recovery(document("recovery-two", 40), 41)
            .unwrap();
        database
            .save_template(&LocalTemplate {
                id: "template".into(),
                name: "Exported template".into(),
                created_at: 34,
                document: document("template-document", 34),
            })
            .unwrap();
        database
            .set_preference("aperglyph.test-setting", "enabled")
            .unwrap();

        let snapshot = database.export_workspace_snapshot().unwrap();
        assert_eq!(snapshot.documents.len(), 1);
        assert_eq!(snapshot.documents[0].trashed_at, Some(30));
        assert_eq!(snapshot.documents[0].favorite, true);
        assert_eq!(snapshot.snapshots.len(), 1);
        assert_eq!(snapshot.recovery.len(), 2);
        assert_eq!(snapshot.recovery[0].document["id"], "recovery-two");
        assert_eq!(snapshot.templates.len(), 1);
        assert_eq!(
            snapshot.preferences,
            vec![("aperglyph.test-setting".into(), "enabled".into())]
        );
    }

    #[test]
    fn migrations_are_versioned_and_reject_newer_schemas() {
        let database = WorkspaceDb::open_in_memory().unwrap();
        assert_eq!(
            database
                .connection
                .lock()
                .unwrap()
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            DATABASE_VERSION
        );
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "user_version", DATABASE_VERSION + 1)
            .unwrap();
        assert!(matches!(
            migrate(&connection),
            Err(StorageError::UnsupportedVersion(2))
        ));
    }
}
