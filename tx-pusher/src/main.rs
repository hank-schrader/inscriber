mod types;
use types::Transaction;
use std::error::Error;

async fn transaction_is_confirmed(tx_id: &str) -> Result<bool, Box<dyn Error>>{
    let response = reqwest::get(format!("http://192.168.0.102:3001/tx/{}", tx_id)).await.unwrap();
    let transaction = response.json::<Transaction>().await.unwrap();
    Ok(transaction.status.confirmed)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // let transaction: Transactin = response
    Ok(())
}
