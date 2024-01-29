import ECPairFactory from "belpair";
import * as belsecp from "bells-secp256k1";

const ECPair = ECPairFactory(belsecp);

export default ECPair;
