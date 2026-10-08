// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// Records Chainlink CRE attestations of verifier grades, delivered by the CRE forwarder through `onReport`.
///
/// v2 (8 Oct): the CRE simulator's forwarder and workflow ids are public and shared by every simulator user, so an
/// attestor configured for simulation accepted reports from anyone. Two rules close that: an optional `relayer`
/// that must have sent the transaction (`tx.origin`), and write-once attestations, so a later report can't flip one.
contract CreAttestor is IERC165 {
    struct Attestation {
        uint32 passed;
        uint32 total;
        uint16 ciLowBps;
        uint16 ciHighBps;
        bool agree;
    }

    // abi.encode of the 9 static report fields.
    uint256 internal constant REPORT_LENGTH = 9 * 32;

    address public immutable owner;
    /// The only account whose transactions may deliver reports; zero disables the check (a deployed DON
    /// delivers through rotating transmitters, which the forwarder already authenticates).
    address public immutable relayer;
    address public forwarder;
    address public workflowOwner;
    // Zero accepts any workflow from workflowOwner.
    bytes32 public workflowId;

    mapping(
        address verifier => mapping(bytes32 model => mapping(bytes32 hostKey => mapping(uint64 t => Attestation)))
    ) public attestations;

    event Configured(address indexed forwarder, address indexed workflowOwner, bytes32 workflowId);
    event GradeAttested(
        address indexed verifier,
        bytes32 indexed model,
        bytes32 indexed hostKey,
        uint64 t,
        bool agree,
        uint32 passed,
        uint32 total
    );

    error NotOwner();
    error AlreadyConfigured();
    error BadConfig();
    error NotForwarder();
    error BadMetadata();
    error UnauthorizedWorkflow();
    error BadReport();
    error NotRelayer();
    error AlreadyAttested();

    constructor(address owner_, address relayer_) {
        owner = owner_;
        relayer = relayer_;
    }

    /// One-time setup. The forwarder is shared by every CRE workflow, so reports are also pinned to our workflow.
    function configure(address forwarder_, address workflowOwner_, bytes32 workflowId_) external {
        if (msg.sender != owner) revert NotOwner();
        if (forwarder != address(0)) revert AlreadyConfigured();
        if (forwarder_ == address(0) || workflowOwner_ == address(0)) revert BadConfig();
        (forwarder, workflowOwner, workflowId) = (forwarder_, workflowOwner_, workflowId_);
        emit Configured(forwarder_, workflowOwner_, workflowId_);
    }

    /// CRE IReceiver entry point. KeystoneForwarder metadata is
    /// abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner, bytes2 reportName).
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();
        // tx.origin on purpose: the forwarder is the caller, and the question is who sent the transaction.
        if (relayer != address(0) && tx.origin != relayer) revert NotRelayer();
        if (metadata.length < 64) revert BadMetadata();
        bytes32 id = bytes32(metadata[0:32]);
        address wfOwner = address(bytes20(metadata[42:62]));
        if (wfOwner != workflowOwner || (workflowId != 0 && id != workflowId)) revert UnauthorizedWorkflow();
        if (report.length != REPORT_LENGTH) revert BadReport();
        (
            address verifier,
            bytes32 model,
            bytes32 hostKey,
            uint64 t,
            uint32 passed,
            uint32 total,
            uint16 ciLowBps,
            uint16 ciHighBps,
            bool agree
        ) = abi.decode(report, (address, bytes32, bytes32, uint64, uint32, uint32, uint16, uint16, bool));
        if (total == 0 || passed > total || ciLowBps > ciHighBps || ciHighBps > 10_000) revert BadReport();

        Attestation storage slot = attestations[verifier][model][hostKey][t];
        if (slot.total != 0) revert AlreadyAttested();
        attestations[verifier][model][hostKey][t] = Attestation(passed, total, ciLowBps, ciHighBps, agree);
        emit GradeAttested(verifier, model, hostKey, t, agree, passed, total);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        // IReceiver has the single function onReport, so its interface id is that selector.
        return interfaceId == type(IERC165).interfaceId || interfaceId == CreAttestor.onReport.selector;
    }
}
