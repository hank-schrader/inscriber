mod types;
use types::{Transaction, Inscription};
use std::error::Error;


pub trait ContextWrapper<T, E> {
        fn wrap(self) -> Result<T, anyhow::Error>;
    }

    impl<T, E: std::fmt::Display> ContextWrapper<T, E> for Result<T, E> {
        #[track_caller]
        fn wrap(self) -> Result<T, anyhow::Error> {
            match self {
                Ok(v) => Ok(v),
                Err(e) => {
                    let loc = std::panic::Location::caller();
                    Err(anyhow::anyhow!("\n- [{}:{}]\n- {e}", loc.file(), loc.line()))
                }
            }
        }
    }


async fn transaction_is_confirmed(tx_id: &str) -> anyhow::Result<bool>{
    let response = reqwest::get(format!("http://192.168.0.102:3001/tx/{}", tx_id)).await.wrap()?;
    let transaction = response.json::<Transaction>().await.wrap()?;
    Ok(transaction.status.confirmed)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let file = "./inscriptions.json";
    let inscriptions: Vec<Inscription> = serde_json::from_slice(&tokio::fs::read(file).await.wrap()?).wrap()?;
    inscriptions.iter().map()
    Ok(())
}
