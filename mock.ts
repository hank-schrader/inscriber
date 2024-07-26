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
const SPLITTER_FEE = 10_000;
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
    answer: [1000, 1000, 1000],
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
    answer: [1000, 1000, 132000, 1500, 1000, 1000, 1000, 1000],
  },
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
    answer: [1000, 1000, 1000],
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
        value: 1000,
        inscriptions: [{ offset: 300 }]
      },
      {
        txid: "",
        vout: 0,
        value: 1_000_000,
        inscriptions: [{ offset: 0 }]
      }
    ],
    answer: [1000, 1000, 132000, 1500, 1000, 1000],
  }
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

const calc = (v: Split) => (
  v.value - v.inscriptions[v.inscriptions.length - 1].offset - ORD_VALUE
);

export const split = (
  psbt: Psbt,
  ords: Split[],
  feeRate: number,
  testnet: boolean = true
) => {
  let changeFromLastUtxo = 0;
  let serviceFeeLeft = testnet ? 0 : SPLITTER_FEE;

  let outputs: { address: string; value: number; type: "ord" | "utxo" }[] = [];

  ords.sort((a, b) =>
    calc(a) - calc(b)
  ).forEach((utxo) => {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
    });

    let lastOffsetWithValue = 0;

    utxo.inscriptions.forEach((inc) => {
      let offset = inc.offset + changeFromLastUtxo;

      if (offset - lastOffsetWithValue >= ORD_VALUE) {
        outputs.push({
          address,
          value: offset - lastOffsetWithValue,
          type: "utxo"
        });
        changeFromLastUtxo = 0;

        offset = inc.offset;
      } else {
        offset -= offset - lastOffsetWithValue;
      }

      if (utxo.value - offset < ORD_VALUE) {
        const v = ORD_VALUE - (utxo.value - offset);

        changeFromLastUtxo = 0;

        if (outputs[outputs.length - 1].value - v >= ORD_VALUE) {
          offset -= v;
          outputs[outputs.length - 1].value -= v;
        } else {
          outputs[outputs.length - 1].value += utxo.value - offset;
          outputs[outputs.length - 1].type = "ord";
          lastOffsetWithValue = utxo.value;
          return;
        }
      }

      if (changeFromLastUtxo < 0) return;

      outputs.push({
        address,
        value: ORD_VALUE + changeFromLastUtxo,
        type: "ord"
      });

      lastOffsetWithValue = offset + ORD_VALUE;
      changeFromLastUtxo = 0;
    });

    changeFromLastUtxo = utxo.value - lastOffsetWithValue;
  });

  const fee = calculateFee(psbt.txInputs.length, outputs.length + 1, feeRate);
  const change = ords.reduce((prev, cur) => prev + cur.value, 0) - outputs.reduce((prev, cur) => prev + cur.value, 0);
  const isFeePaid = change - fee >= 0;

  if (isFeePaid) {
    outputs.push({
      address,
      value: change - fee,
      type: "utxo"
    });
  }

  outputs = outputs.map((out) => {
    if (serviceFeeLeft > 0 && out.type === "utxo") {
      if (out.value < serviceFeeLeft) {
        serviceFeeLeft -= out.value;

        return [
          {
            ...out,
            address: MAINNET_SPLITTER_FEE_ADDRESS
          }
        ];
      } else {
        const toServiceFee = out.value - serviceFeeLeft < 1000 ? serviceFeeLeft - (out.value - serviceFeeLeft) : serviceFeeLeft;
        serviceFeeLeft -= toServiceFee;

        return [
          {
            address: MAINNET_SPLITTER_FEE_ADDRESS,
            value: toServiceFee,
            type: "utxo" as "utxo"
          },
          {
            address: out.address,
            value: out.value - toServiceFee,
            type: "utxo" as "utxo"
          }
        ]
      }
    }
    return out;
  }).flat();

  outputs.forEach(out => psbt.addOutput(out));

  return {
    change: change - fee,
    isFeePaid,
    serviceFeeLeft
  };
};
