# @rehold-io/smart-contracts

Crypto Boost for Everyone. https://rehold.io

## Contracts on Binance Smart Chain (BSC)

* **DualFactory** - interacting with duals: creating, claiming, and replaying (https://bscscan.com/address/0x3185b7c3a4e646fb23c6c04d979e61da7871b5c1);
* **Vault** - all money operations for creating & claiming duals and referral program claims (https://bscscan.com/address/0xd476ce848C61650E3051f7571f3Ae437Fe9A32E0);
* **Referral** - referral earnings and claims (https://bscscan.com/address/0x868A943ca49A63eB0456a00AE098D470915EEA0D);
* **Price Feed** - interacting with price oracles by Chainlink (https://bscscan.com/address/0x6339329BB0558047caCD8Df4312fE6b1c9F47b59).

## Compile

```sh
$ npm run compile
````

## Tests

All smart contracts are **100%** covered by auto-tests.

```sh
$ npm run test:coverage
```

```sh
-----------------------|----------|----------|----------|----------|----------------|
File                   |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
-----------------------|----------|----------|----------|----------|----------------|
 contracts/            |      100 |      100 |      100 |      100 |                |
  Dual.sol             |      100 |      100 |      100 |      100 |                |
  PriceFeed.sol        |      100 |      100 |      100 |      100 |                |
  Referral.sol         |      100 |      100 |      100 |      100 |                |
  Vault.sol            |      100 |      100 |      100 |      100 |                |
```
