// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ReceiptAnchor} from "../src/ReceiptAnchor.sol";
import {VerifierRegistry} from "../src/VerifierRegistry.sol";
import {CreAttestor} from "../src/CreAttestor.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";

/// IDENTITY_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e \
/// forge script script/Deploy.s.sol --rpc-url monad_testnet --account assay-host --sender <assay-host address> --broadcast
/// Set DEPLOY_CRE_ATTESTOR=true to also deploy CreAttestor, owned by the sender. CRE_RELAYER pins the only account
/// whose transactions may deliver reports (needed for an attestor configured for the CRE simulator).
contract Deploy is Script {
    function run() external returns (ReceiptAnchor ra, VerifierRegistry vr, CreAttestor cre) {
        IIdentityRegistry identity = IIdentityRegistry(vm.envAddress("IDENTITY_REGISTRY"));
        require(address(identity).code.length > 0, "IDENTITY_REGISTRY has no code on this chain");

        vm.startBroadcast();
        ra = new ReceiptAnchor(identity, true);
        vr = new VerifierRegistry(identity);
        if (vm.envOr("DEPLOY_CRE_ATTESTOR", false)) cre = new CreAttestor(msg.sender, vm.envOr("CRE_RELAYER", address(0)));
        vm.stopBroadcast();

        console.log("chainId          ", block.chainid);
        console.log("ReceiptAnchor    ", address(ra));
        console.log("VerifierRegistry ", address(vr));
        if (address(cre) != address(0)) console.log("CreAttestor      ", address(cre));
    }
}
