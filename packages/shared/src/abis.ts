export const ROUTER_ABI = [
  {
    name: "operate",
    type: "function",
    inputs: [
      { name: "pool", type: "address" },
      { name: "positionId", type: "uint256" },
      { name: "newColl", type: "int256" },
      { name: "newDebt", type: "int256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "payable",
  },
  {
    name: "instantRedeemFromFxSave",
    type: "function",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;

export const LIMIT_ORDER_MANAGER_ABI = [
  {
    name: "cancelOrder",
    type: "function",
    inputs: [{ name: "orderHash", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "increaseNonce",
    type: "function",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    name: "allowance",
    type: "function",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;
