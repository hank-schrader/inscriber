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
    answer: [1000, 1000, 100_000 - 2000 - calculateFee(1, 3, 200)],
  },
  {
    toSplit: [
      {
        txid: "",
        vout: 0,
        value: 2000,
        inscriptions: [{ offset: 0 }],
      },
    ],
    answer: [1000, 2000 - 1000 - calculateFee(1, 2, 200)],
  },
  {
    toSplit: [
      {
        txid: "",
        vout: 0,
        value: 2000,
        inscriptions: [{ offset: 500 }],
      },
    ],
    answer: [1000, 2000 - 1000 - calculateFee(1, 2, 200)],
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
    answer: [
      1500,
      1000,
      2500,
      1000,
      140000 - 2000 - 4000 - calculateFee(2, 5, 200),
    ],
  },
  {
    toSplit: [
      {
        txid: "",
        vout: 0,
        value: 1600,
        inscriptions: [{ offset: 1500 }],
      },
      {
        txid: "",
        vout: 0,
        value: 135000,
        inscriptions: [{ offset: 0 }],
      },
    ],
    answer: [1600, 1000, 140000 - 2600 - calculateFee(2, 3, 200)],
  },
];

export function get_mock(idx: number): SplitAnswer {
  const mock = mocks[idx];
  let fakeTx = new Transaction();
  let fakeTxid = new Array(64).fill(0).join("");
  fakeTx.addInput(Buffer.from(fakeTxid, "hex"), 0);

  return {
    ...mock,
    toSplit: mock.toSplit.map((f, i) => ({
      ...f,
      txid: fakeTx.getId(),
      vout: i,
    })),
  };
}

export const split = (
  psbt: Psbt,
  ords: Split[],
  feeRate: number,
  testnet: boolean = true
): SplitResult => {
  let prevOrdOffset = 0;
  let serviceFeeLeft = testnet ? 0 : SPLITTER_FEE;

  ords
    .sort((a, b) => {
      const calc = (v: Split) =>
        v.value - v.inscriptions[v.inscriptions.length - 1].offset - 1000;
      return calc(a) - calc(b);
    })
    .forEach((ord) => {
      psbt.addInput({
        hash: ord.txid,
        index: ord.vout,
      });

      let lastOffset = 0;

      ord.inscriptions.forEach((inc) => {
        let offset = inc.offset + prevOrdOffset;

        if (offset - lastOffset >= 1000) {
          if (serviceFeeLeft > 0) {
            let toSeriveFee = Math.min(serviceFeeLeft, offset - lastOffset);
            psbt.addOutput({
              address: MAINNET_SPLITTER_FEE_ADDRESS,
              value: toSeriveFee,
            });

            if (toSeriveFee < offset - lastOffset) {
              const toPay = offset - lastOffset - toSeriveFee;
              if (toPay >= 1000) {
                psbt.addOutput({
                  address,
                  value: toPay,
                });
              } else {
                prevOrdOffset = toPay;
              }
            }
          } else {
            psbt.addOutput({
              address,
              value: offset - lastOffset,
            });
            prevOrdOffset = 0;
          }

          offset = inc.offset;
        }

        psbt.addOutput({
          address,
          value: ORD_VALUE + prevOrdOffset,
        });

        lastOffset = offset + ORD_VALUE;
        prevOrdOffset = 0;
      });

      prevOrdOffset = ord.value - lastOffset;
    });

  const fee = calculateFee(
    psbt.txInputs.length,
    psbt.txOutputs.length + 1,
    feeRate
  );
  const isFeePaid = prevOrdOffset - fee >= 0;

  if (isFeePaid) {
    psbt.addOutput({
      address,
      value: prevOrdOffset - fee,
    });
  }

  return {
    change: prevOrdOffset - fee,
    isFeePaid,
    serviceFeeLeft,
  };
};
