// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice Mock Chainlink ETH/USD oracle for testing.
 */
contract MockOracle {
    int256 public price;
    uint8 public dec;
    uint256 public lastUpdate;

    constructor(int256 _price, uint8 _decimals) {
        price = _price;
        dec = _decimals;
        lastUpdate = block.timestamp;
    }

    function setPrice(int256 _price) external {
        price = _price;
        lastUpdate = block.timestamp;
    }

    function setStale(uint256 age) external {
        lastUpdate = block.timestamp - age;
    }

    function decimals() external view returns (uint8) {
        return dec;
    }

    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        return (1, price, block.timestamp, lastUpdate, 1);
    }
}
