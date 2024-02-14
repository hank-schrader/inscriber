use serde_derive::Deserialize;
use serde_derive::Serialize;

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub txid: String,
    pub version: i64,
    pub locktime: i64,
    pub vin: Vec<Vin>,
    pub vout: Vec<Vout>,
    pub size: i64,
    pub weight: i64,
    pub sigops: i64,
    pub fee: i64,
    pub status: Status,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vin {
    pub txid: String,
    pub vout: i64,
    pub prevout: Prevout,
    pub scriptsig: String,
    #[serde(rename = "scriptsig_asm")]
    pub scriptsig_asm: String,
    #[serde(rename = "is_coinbase")]
    pub is_coinbase: bool,
    pub sequence: i64,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prevout {
    pub scriptpubkey: String,
    #[serde(rename = "scriptpubkey_asm")]
    pub scriptpubkey_asm: String,
    #[serde(rename = "scriptpubkey_type")]
    pub scriptpubkey_type: String,
    #[serde(rename = "scriptpubkey_address")]
    pub scriptpubkey_address: String,
    pub value: i64,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vout {
    pub scriptpubkey: String,
    #[serde(rename = "scriptpubkey_asm")]
    pub scriptpubkey_asm: String,
    #[serde(rename = "scriptpubkey_type")]
    pub scriptpubkey_type: String,
    #[serde(rename = "scriptpubkey_address")]
    pub scriptpubkey_address: String,
    pub value: i64,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub confirmed: bool,
    #[serde(rename = "block_height")]
    pub block_height: i64,
    #[serde(rename = "block_hash")]
    pub block_hash: String,
    #[serde(rename = "block_time")]
    pub block_time: i64,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Inscription {
    pub inscription_number: i64,
    pub txs: Vec<Tx>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tx {
    pub pushed: bool,
    pub tx_hex: String,
}