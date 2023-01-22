// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

import "./IVault.sol";
import "./IPriceFeed.sol";
import "./IReferral.sol";

struct Dual {
  uint256 id;
  uint256 tariffId;
  address user;
  address baseToken;
  address quoteToken;
  address inputToken;
  uint256 inputAmount;
  uint256 inputBaseAmount;
  uint256 inputQuoteAmount;
  address outputToken;
  uint256 outputAmount;
  uint256 stakingPeriod;
  uint256 yield;
  uint256 initialPrice;
  uint256 closedPrice;
  bool claimed;
  uint256 startedAt;
  uint256 finishAt;
}

struct DualTariff {
  uint256 id;
  address baseToken;
  address quoteToken;
  uint256 stakingPeriod;
  uint256 yield;
  bool enabled;
}

struct Limit {
  uint256 minAmount;
  uint256 maxAmount;
}

struct TokenLimit {
  address token;
  uint256 minAmount;
  uint256 maxAmount;
}

interface IDualFactory {
  event DualCreated(uint256 id);
  event DualClaimed(uint256 id);
  event DualReplayed(uint256 id);

  function create(
    uint256 tariffId,
    address _user,
    address inputToken,
    uint256 inputAmount,
    address inviterAddress
  ) external;

  function createETH(uint256 tariffId, address inviterAddress) external payable;

  function replay(uint256 id, uint256 tariffId, uint80 baseRoundId, uint80 quoteRoundId) external;

  function claim(uint256 id, uint80 baseRoundId, uint80 quoteRoundId) external;

  function get(uint256 id) external view returns (Dual memory dual);

  function countUserOpenedDuals(address _user) external view returns (uint256 count);

  function countUserClosedDuals(address _user) external view returns (uint256 count);

  function countUserClaimedDuals(address _user) external view returns (uint256 count);

  function userOpenedDuals(address _user, uint256 limit, uint256 offset) external view returns (Dual[] memory duals);

  function userClosedDuals(address _user, uint256 limit, uint256 offset) external view returns (Dual[] memory duals);

  function userClaimedDuals(address _user, uint256 limit, uint256 offset) external view returns (Dual[] memory duals);

  function user(address _user) external view returns (uint256[] memory);

  function addTariff(DualTariff memory dualTariff) external;

  function enableTariff(uint256 id) external;

  function disableTariff(uint256 id) external;

  function tariffs() external view returns (DualTariff[] memory);

  function updateLimits(address token, Limit calldata _limits) external;

  function limits() external view returns (TokenLimit[] memory tokenLimits);

  function enable() external;

  function disable() external;

  function updateVault(IVault _vault) external;

  function updatePriceFeed(IPriceFeed _priceFeed) external;

  function updateReferral(IReferral _referral) external;
}
