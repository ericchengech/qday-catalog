// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";

contract Deploy is Script {
    // Aevum testnet tUSD8
    address constant TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;

    function run() external returns (address router) {
        vm.startBroadcast();
        router = address(new PaymentRouter(IERC20(TUSD8)));
        vm.stopBroadcast();
        console2.log("PaymentRouter deployed:", router);
    }
}
