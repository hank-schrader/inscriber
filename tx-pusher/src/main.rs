mod types;
use std::fs::File;
use std::io::BufWriter;
use std::vec;
use tokio::time::{sleep, Duration};

use types::{Inscription, Transaction};

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
                Err(anyhow::anyhow!(
                    "\n- [{}:{}]\n- {e}",
                    loc.file(),
                    loc.line()
                ))
            }
        }
    }
}

// const TX_ROUTE: &str = "http://0.0.0.0:3001/tx";
const TX_ROUTE: &str = "https://testnet.nintondo.io/electrs/tx";

async fn transaction_is_confirmed(tx_id: &str) -> anyhow::Result<bool> {
    let response = reqwest::get(format!("{}/{}", TX_ROUTE, tx_id))
        .await
        .wrap()?;
    let transaction = response.json::<Transaction>().await.wrap()?;
    Ok(transaction.status.confirmed)
}

async fn push_tx(tx_hex: &str) -> anyhow::Result<String> {
    let client = reqwest::Client::new();
    let res = client
        .post(format!("{}", TX_ROUTE))
        .body(tx_hex.to_string())
        .send()
        .await;
    match res {
        Err(e) => {
            println!("Error: {}", e);
            return Ok("Error".to_string());
        }
        Ok(res) => {
            let response = res.text().await.wrap()?;
            Ok(response)
        }
    }
}

async fn check_inscription(inscription: &mut Inscription) -> anyhow::Result<Option<Inscription>> {
    println!("Checking inscription: {}", inscription.inscription_number);
    let last_pushed = inscription.txs.iter().filter(|x| x.pushed).last();
    if let Some(tx) = last_pushed {
        println!("Last pushed tx: {}", tx.tx_id.as_ref().unwrap());
        if !transaction_is_confirmed(&tx.tx_id.as_ref().unwrap())
            .await
            .wrap()?
        {
            println!("👵👵👵 Last pushed tx was not confirmed");
            return Ok(None);
        }
    }
    for tx in inscription.txs.iter_mut().filter(|x| !x.pushed).take(25) {
        let tx_id = push_tx(&tx.tx_hex).await.wrap()?;
        if tx_id.len() == 64 {
            println!("✅ Inscription: {}", tx_id);
            tx.pushed = true;
            tx.tx_id = Some(tx_id);
        } else {
            println!("❌ Error while pushing tx: {}", tx_id);
            return Ok(None);
        }
    }
    Ok(Some(inscription.clone()))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let file = "./inscriptions.json";
    println!("Reading inscriptions from {} file", file);
    loop {
        let inscriptions: Vec<Inscription> =
            serde_json::from_slice(&tokio::fs::read(file).await.wrap()?).wrap()?;
        println!("{} inscription(s) to go", inscriptions.len());

        let mut updated_inscriptions: Vec<Inscription> = vec![];
        let mut finished = true;

        for mut inscription in inscriptions {
            let updated_inscription = check_inscription(&mut inscription).await.wrap()?;
            if let Some(inscription) = updated_inscription {
                if inscription.txs.iter().filter(|tx| !tx.pushed).count() > 0 {
                    finished = false;
                    println!(
                        "{}/{} transactions to push",
                        inscription.txs.iter().filter(|tx| !tx.pushed).count(),
                        inscription.txs.len()
                    );
                    updated_inscriptions.push(inscription);
                } else {
                    println!(
                        "👀 Inscription {} is finished",
                        inscription.inscription_number
                    );
                }
            } else {
                finished = false;
                updated_inscriptions.push(inscription);
            }
        }

        let file = File::create(file)?;
        let writer = BufWriter::new(file);
        serde_json::to_writer(writer, &updated_inscriptions)?;
        if finished {
            break;
        }
        sleep(Duration::from_secs(5)).await;
    }
    Ok(())
}

//let txs: HashMap<String, bool> = inscriptions.iter().flat_map(|x| x.txs.iter().map(|x| (x.tx_hex.clone(), x.pushed))).collect();
