// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AgentWalletFactory} from "../src/AgentWalletFactory.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        uint256 gasFunding = vm.envOr("GAS_FUNDING", uint256(0.1 ether));

        vm.startBroadcast(deployerKey);

        // Deploy factory
        AgentWalletFactory factory = new AgentWalletFactory();
        console.log("Factory deployed at:", address(factory));
        console.log("Implementation at:", factory.implementation());
        console.log("Admin:", factory.admin());

        // Fund factory gas treasury
        if (gasFunding > 0 && address(msg.sender).balance >= gasFunding) {
            (bool ok, ) = address(factory).call{value: gasFunding}("");
            require(ok, "Failed to fund factory");
            console.log("Factory funded with:", gasFunding);
        }

        vm.stopBroadcast();
    }
}
