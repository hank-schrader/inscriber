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
    answer: [1000, 1000, 132000, 1000, 1500, 1000, 1000, 1000],
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
      }
    ],
    answer: [1000, 1000, 132000, 1000, 1500],
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
  let changeFromLastUtxo = 0;
  // let serviceFeeLeft = isTestnet(network) ? 0 : SPLITTER_FEE;
  let serviceFeeLeft = 0;

  let outputs: { address: string; value: number }[] = [];

  ords.sort((a, b) => {
    const calc = (v: Split) => (
      v.value - v.inscriptions[v.inscriptions.length - 1].offset - ORD_VALUE
    );
    return calc(a) - calc(b);
  }).forEach((ord, txIdx) => {
    psbt.addInput({
      hash: ord.txid,
      index: ord.vout,
    });

    let lastOffsetWithValue = 0;
    let lastOffset: number | undefined;

    ord.inscriptions.forEach((inc, idx) => {
      let offset = inc.offset + changeFromLastUtxo;
      let diff: number | undefined;

      if (ord.value - offset < ORD_VALUE) {
        const v = ORD_VALUE - (ord.value - offset);
        offset -= v;
        diff = v;
      }

      if (typeof lastOffset !== "undefined" && offset - lastOffset < 1000) {
        if (idx === ord.inscriptions.length - 1 && txIdx === ords.length - 1) {
          outputs[outputs.length - 1].value += offset - lastOffset;
        }
        return;
      }

      if (offset - lastOffsetWithValue >= ORD_VALUE) {
        if (serviceFeeLeft > 0) {
          let toServiceFee = Math.min(serviceFeeLeft, offset - lastOffsetWithValue);
          outputs.push({
            address: MAINNET_SPLITTER_FEE_ADDRESS,
            value: toServiceFee
          });
          serviceFeeLeft -= toServiceFee;

          if (toServiceFee < offset - lastOffsetWithValue) {
            const toPay = offset - lastOffsetWithValue - toServiceFee;
            if (toPay >= ORD_VALUE) {
              outputs.push({
                address,
                value: toPay
              });
            } else {
              changeFromLastUtxo += toPay;
            }
          }
        } else {
          outputs.push({
            address,
            value: offset - lastOffsetWithValue
          });
          changeFromLastUtxo = 0;
        }

        offset = inc.offset;
      } else {
        offset -= offset - lastOffsetWithValue;
      }

      outputs.push({
        address,
        value: ORD_VALUE + changeFromLastUtxo
      });

      if (diff !== undefined) {
        changeFromLastUtxo -= diff;
      }

      lastOffsetWithValue = offset + ORD_VALUE + changeFromLastUtxo;
      lastOffset = offset;
      changeFromLastUtxo = 0;
    });

    changeFromLastUtxo = ord.value - lastOffsetWithValue;
  });

  const fee = calculateFee(psbt.txInputs.length, outputs.length + 1, feeRate);
  const isFeePaid = changeFromLastUtxo - fee >= 0;

  if (isFeePaid) {
    outputs.push({
      address,
      value: changeFromLastUtxo - fee
    });
  }

  outputs.forEach(out => psbt.addOutput(out));

  console.log(changeFromLastUtxo - fee);
  console.log(ords.reduce((acc, val) => acc + val.value, 0) - psbt.txOutputs.reduce((acc, val) => acc + val.value, 0));
  console.log(fee);

  return {
    change: changeFromLastUtxo - fee,
    isFeePaid,
    serviceFeeLeft
  };
};
