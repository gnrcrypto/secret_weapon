import { ethers } from 'ethers';

const PRIVATE_KEY = "c5bde30beda7a1f52176bb8a8d25997e5a5cd167bcfd52e307114522acebf577";
const wallet = new ethers.Wallet(PRIVATE_KEY);

// Define your domain (adjust these values for your contract)
const domain = {
  name: "claim",
  version: "1",
  chainId: 137, // 1 = Ethereum mainnet, 137 = Polygon, etc.
  verifyingContract: "0xf3e4c1f21a1218ae8e48569c94275abd605563fd"
};

// Define the data types
const types = {
  Claim: [
    { name: "index", type: "uint256" },
    { name: "receiver", type: "address" },
    { name: "vestingAmount", type: "uint256" },
    { name: "proof", type: "bytes32[]" },
    { name: "mode", type: "uint8" }
  ]
};

// Your values
const value = {
  index: 47,
  receiver: "0x6d3D531699b801587f039fb2a766c9E5Ef9E52cb",
  vestingAmount: "155631280000",
  proof: [
    "0xc93401ee7ed832ce3a5a9232d2db0a6f32ebb06c4b8fe03e356c278fcbc5816b",
    "0xe5e95f9f21570df01d13de57ae320c38ba529b47bff3cda3f7c6d52b920e90c8",
    "0xa5eed434692cc957614bdb66c3408e4a01a63ad2395fc00af718a83249a77502",
    "0xaa31964ab172bdf6d62eb63b9010198f12b60599e3e726925793492ffdf1ce94",
    "0x04dae754d0f27e67c97a389bc1163e6facdb3da850b0d21655050ab38693f1ac",
    "0xe429eb1ea4a77ea60608109e8bfb16a238e28a8552c68e1d2e1b5c44f8f0ee56",
    "0x722fc59d5f8b9e5aaf971f7087b55ba56e62b8952748f9ad2ea56b5ce663fe5f",
    "0xff99cf0e47671ea5124dbc420c5377e3cfed0cd0389c584f8d62e1b72cca0b33",
    "0x95567dbbed54525c3602fc05643058efdb591784f66a1533e0c0b65d424052e3",
    "0xbfee70c347ccb76f6c76b45c5d49063c9bda5eef5545dd61ed9eea7f3109187d"
  ],
  mode: 1
};

// Sign the typed data
const signature = await wallet.signTypedData(domain, types, value);

console.log("Wallet Address:", wallet.address);
console.log("Signature:", signature);
