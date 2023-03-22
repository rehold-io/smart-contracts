// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

contract PayableContract {
  address payable tresuary;
  mapping(address => uint256) incomes;

  constructor(address payable tresuary_) {
    tresuary = tresuary_;
  }

  fallback() external payable {
    // need to some logic for payable operations like sending funds to the treasure
    incomes[msg.sender] += msg.value;

    require(tresuary.send(msg.value));
  }
}
