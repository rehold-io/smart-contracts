# @rehold-io/smart-contracts

Crypto Boost for Everyone. https://rehold.io

## Versions

The protocol has two versions of smart contracts:

* [V1](https://github.com/rehold-io/smart-contracts/tree/v1) is already deployed on BNB Chain. We will not deploy these contracts anymore and will migrate BNB Chain to the new ones very soon.
* [V2](https://github.com/rehold-io/smart-contracts/tree/v2) will be deployed on new blockchains (Polygon, Arbitrum, Optimism, etc). It's more effective and optimized contracts, it reduces users' costs on transactions.

## Audit

Audited by [PeckShield](https://github.com/peckshield/publications/blob/master/audit_reports/PeckShield-Audit-Report-ReHold-v1.0.pdf).

## Contracts on Binance Smart Chain (BSC)

* **Dual Factory** - interacting with duals: creating, claiming, and replaying (https://bscscan.com/address/0x3185b7c3a4e646fb23c6c04d979e61da7871b5c1);
* **Vault** - all money operations for creating & claiming duals and referral program claims (https://bscscan.com/address/0xd476ce848C61650E3051f7571f3Ae437Fe9A32E0);
* **Referral** - referral earnings and claims (https://bscscan.com/address/0x868A943ca49A63eB0456a00AE098D470915EEA0D);
* **Price Feed** - interacting with price oracles by Chainlink (https://bscscan.com/address/0x6339329BB0558047caCD8Df4312fE6b1c9F47b59).

## Contracts on Polygon (MATIC)

* **Dual Factory** - interacting with duals: creating, claiming, and replaying (https://polygonscan.com/address/0x868A943ca49A63eB0456a00AE098D470915EEA0D);
* **Vault** - all money operations for creating & claiming duals and referral program claims (https://polygonscan.com/address/0xd476ce848C61650E3051f7571f3Ae437Fe9A32E0);
* **Price Feed** - interacting with price oracles by Chainlink (https://polygonscan.com/address/0x6339329BB0558047caCD8Df4312fE6b1c9F47b59).

## Contracts on Optimism (OP)

* **Dual Factory** - interacting with duals: creating, claiming, and replaying (https://optimistic.etherscan.io/address/0x868A943ca49A63eB0456a00AE098D470915EEA0D);
* **Vault** - all money operations for creating & claiming duals and referral program claims (https://optimistic.etherscan.io/address/0xd476ce848C61650E3051f7571f3Ae437Fe9A32E0);
* **Price Feed** - interacting with price oracles by Chainlink (https://optimistic.etherscan.io/address/0x6339329BB0558047caCD8Df4312fE6b1c9F47b59).

## Contracts on Avalanche (AVAX)

* **Dual Factory** - interacting with duals: creating, claiming, and replaying (https://snowtrace.io/address/0x868A943ca49A63eB0456a00AE098D470915EEA0D);
* **Vault** - all money operations for creating & claiming duals and referral program claims (https://snowtrace.io/address/0xd476ce848C61650E3051f7571f3Ae437Fe9A32E0);
* **Price Feed** - interacting with price oracles by Chainlink (https://snowtrace.io/address/0x6339329BB0558047caCD8Df4312fE6b1c9F47b59).

## Contracts on Fantom (FTM)

* **Dual Factory** - interacting with duals: creating, claiming, and replaying (https://ftmscan.com/address/0x868A943ca49A63eB0456a00AE098D470915EEA0D);
* **Vault** - all money operations for creating & claiming duals and referral program claims (https://ftmscan.com/address/0xd476ce848C61650E3051f7571f3Ae437Fe9A32E0);
* **Price Feed** - interacting with price oracles by Chainlink (https://ftmscan.com/address/0x6339329BB0558047caCD8Df4312fE6b1c9F47b59).

## NFTs on Binance Smart Chain (BSC)

* **Early Adopter** - opened at least one dual during a Private Launch (https://bscscan.com/address/0xfc9056fa7923e1f3e182ae29f251a95108f1cddf)
* **Gold Early Adopter** - invited at least one friend during a Private Launch (https://bscscan.com/address/0x0b75014f102163b0e86f6f93a12f860a291d8933)

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
