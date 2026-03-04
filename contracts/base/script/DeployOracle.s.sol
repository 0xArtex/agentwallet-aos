// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

/**
 * @notice Mock Chainlink ETH/USD oracle for Base Sepolia testnet.
 * Chainlink doesn't have feeds on Base Sepolia, so we deploy our own.
 * On mainnet, use the real Chainlink feed.
 */
contract MockChainlinkOracle {
    int256 public price;
    uint8 public constant decimals = 8;
    address public admin;
    uint256 public lastUpdate;

    constructor(int256 _price) {
        price = _price;
        admin = msg.sender;
        lastUpdate = block.timestamp;
    }

    function setPrice(int256 _price) external {
        require(msg.sender == admin, "not admin");
        price = _price;
        lastUpdate = block.timestamp;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (1, price, lastUpdate, lastUpdate, 1);
    }
}

contract DeployOracleScript is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        int256 ethPrice = vm.envOr("ETH_PRICE", int256(2000e8)); // default $2000

        vm.startBroadcast(deployerKey);

        MockChainlinkOracle oracle = new MockChainlinkOracle(ethPrice);
        console.log("Mock Oracle deployed at:", address(oracle));
        console.log("ETH price set to:", uint256(ethPrice) / 1e8, "USD");

        vm.stopBroadcast();
    }
}
