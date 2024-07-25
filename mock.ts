import { networks, payments, Psbt, Transaction } from "belcoinjs-lib";
import ECPair from "./ecpair";
import { calculateFee } from "./utils";

export interface Split {
  txid: string;
  vout: number;
  value: number;
  inscriptions: SplitInscription[];
}

export interface SplitInscription {
  offset: number;
}

export interface SplitAnswer {
  toSplit: Split[];
  answer: number[];
}

interface SplitResult {
  isFeePaid: boolean;
  serviceFeeLeft: number;
  change: number;
}

const ORD_VALUE = 1000;
const SPLITTER_FEE = 1_000_000;
const MAINNET_SPLITTER_FEE_ADDRESS = "EMpxzi7FujHsQHbrZy7wsuiRHFsvxKZSaB";
const address = "EMpxzi7FujHsQHbrZy7wsuiRHFsvxKZSaB";

export const mocks: SplitAnswer[] = [
  {
    toSplit: [
      {
        txid: "",
        vout: 0,
        value: 100_000,
        inscriptions: [{ offset: 0 }, { offset: 1000 }],
      },
    ],
    answer: [1000, 1000],
  },
  {
    toSplit: [
      {
        txid: "",
        vout: 0,
        value: 60000,
        inscriptions: [{ offset: 0 }],
      },
    ],
    answer: [1000],
  },
  {
    toSplit: [
      {
        txid: "",
        vout: 0,
        value: 2000,
        inscriptions: [{ offset: 500 }],
      },
      {
        txid: "",
        vout: 0,
        value: 1_000_000,
        inscriptions: [{ offset: 0 }],
      },
    ],
    answer: [1000, 1000],
  },
  {
    toSplit: [
      {
        txid: "",
        vout: 0,
        value: 5000,
        inscriptions: [{ offset: 1500 }],
      },
      {
        txid: "",
        vout: 0,
        value: 135000,
        inscriptions: [{ offset: 0 }],
      },
    ],
    answer: [1500, 1000, 2500, 1000],
  },
  {
    toSplit: [
      {
        txid: "",
        vout: 0,
        value: 200600,
        inscriptions: [{ offset: 200500 }],
      },
      {
        txid: "",
        vout: 0,
        value: 135000,
        inscriptions: [{ offset: 0 }],
      },
    ],
    answer: [199600, 1000, 1000],
  },
  {
    toSplit: [
      {
        txid: "",
        vout: 0,
        value: 200600,
        inscriptions: [{ offset: 200500 }, { offset: 200501 }],
      },
      {
        txid: "",
        vout: 0,
        value: 135000,
        inscriptions: [{ offset: 0 }],
      },
    ],
    answer: [199600, 1000, 1000],
  },
  {
    toSplit: [
      {
        txid: "",
        vout: 0,
        value: 135000,
        inscriptions: [{ offset: 0 }, { offset: 134999 }],
      },
      {
        txid: "",
        vout: 0,
        value: 200600,
        inscriptions: [{ offset: 200500 }, { offset: 200501 }],
      },

      {
        txid: "",
        vout: 0,
        value: 1_000_000,
        inscriptions: [{ offset: 0 }],
      },
    ],
    answer: [1000, 133000, 1000, 199600, 1000, 1000],
  },
  {
    toSplit: [
      {
        txid: "",
        vout: 0,
        value: 135000,
        inscriptions: [{ offset: 0 }, { offset: 1001 }, { offset: 134999 }],
      },
      {
        txid: "",
        vout: 0,
        value: 200600,
        inscriptions: [{ offset: 200500 }, { offset: 200501 }],
      },

      {
        txid: "",
        vout: 0,
        value: 1_000_000,
        inscriptions: [{ offset: 0 }],
      },
    ],
    answer: [1000, 1000, 132000, 1000, 199600, 1000, 1000],
  },
  {
    toSplit: [
      {
        txid: "",
        vout: 0,
        value: 135500,
        inscriptions: [
          { offset: 0 },
          { offset: 1001 },
          { offset: 134000 },
          { offset: 135300 },
        ],
      },
      {
        txid: "",
        vout: 0,
        value: 3000,
        inscriptions: [{ offset: 1000 }],
      },
      {
        txid: "",
        vout: 0,
        value: 1_000_000,
        inscriptions: [{ offset: 0 }],
      },
    ],
    answer: [1000, 1000, 132000, 1301, 1199, 1000, 1000, 1000],
  },
];

export function get_mock(idx: number): SplitAnswer {
  const mock = mocks[idx];
  let fakeTx = new Transaction();
  let fakeTxid = new Array(64).fill(0).join("");
  fakeTx.addInput(Buffer.from(fakeTxid, "hex"), 0);

  const change =
    mock.toSplit.reduce((acc, val) => acc + val.value, 0) -
    mock.answer.reduce((acc, val) => acc + val, 0) -
    calculateFee(mock.toSplit.length, mock.answer.length + 1, 200);

  return {
    answer: [...mock.answer, change],
    toSplit: mock.toSplit.map((f, i) => ({
      ...f,
      txid: fakeTx.getId(),
      vout: i,
    })),
  };
}

interface TestOffset {
  value: number;
  offsets: number[];
}

export const split = (
  psbt: Psbt,
  ords: Split[],
  feeRate: number,
  testnet: boolean = true
) => {
  const offsets: TestOffset[] = ords.map(i => ({
    value: i.value, offsets: i.inscriptions.map(i => i.offset)
  })).sort((a, b) => a.offsets[a.offsets.length - 1] - b.offsets[b.offsets.length - 1]);

  let outputs: number[] = [];
  let lastOutputType: "utxo" | "ord" | undefined;

  const checkedOffsets: TestOffset[] = [];

  offsets.forEach((i) => {
    let utxoValue = i.value;

    i.offsets.forEach((offset) => {
      let change = offset - outputs.reduce((acc, val) => acc + val, 0);
      console.log(`CHANGE: ${change}`)

      if (!lastOutputType && change < 1000) {
        console.log(`LAST output type: ${lastOutputType}, pushing ord value`)
        outputs.push(ORD_VALUE);
        lastOutputType = "ord";
        if (change > 0) {
          console.log(`change^^: ${change}`)
          outputs.push(change);
          lastOutputType = "utxo";
        }
        return;
      }

      if (utxoValue - offset < 1000) {
        change -= ORD_VALUE - (utxoValue - offset);
        console.log(`change: ${change} after ORD_VAUE - shit`)
      }

      if (lastOutputType === "utxo") {
        outputs[outputs.length - 1] += change;
        console.log(`LAST value is utxo ,change`)
      } else if (change > 0) {
        outputs.push(change);
        console.log(`PUSHING change: ${change}`)
        lastOutputType = "utxo";
      }

      const lastOrdValue = Math.min(ORD_VALUE, utxoValue - offset);
      console.log(`lastOrdValue: ${lastOrdValue}`)
      if (lastOrdValue < 1000) {
        if (outputs[outputs.length - 1] - lastOrdValue >= ORD_VALUE) {
          outputs[outputs.length - 1] -= ORD_VALUE - lastOrdValue;
          outputs.push(ORD_VALUE);
          console.log("reduced last output value and pushed 1000")
        } else {
          outputs[outputs.length - 1] += lastOrdValue;
          console.log("added lastord value to the last ouput")
        }
      } else {
        outputs.push(ORD_VALUE);
        console.log("PUSHED LAST SHIT")
      }
      lastOutputType = "ord";
    })

    checkedOffsets.push(i);
    outputs.push(checkedOffsets.reduce((acc, val) => acc + val.value, 0) - outputs.reduce((acc, val) => acc + val, 0));
  });

  console.log(outputs);

  ords.forEach((ord, i) => {
    psbt.addInput({
      hash: ord.txid,
      index: ord.vout,
    });
  });

  const fee = calculateFee(ords.length, outputs.length, feeRate);

  outputs.forEach((output, idx) => {
    psbt.addOutput({
      address,
      value: idx === outputs.length - 1 ? output - fee : output
    })
  });
};
