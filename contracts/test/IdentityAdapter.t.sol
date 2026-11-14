// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "./utils/Vm.sol";
import {Base} from "./utils/Base.sol";
import {IdentityAdapter} from "../src/IdentityAdapter.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract IdentityAdapterTest is Base {
    IdentityAdapter internal id;

    uint256 internal constant ATTESTER_KEY = 0xA77E57;
    address internal attester;
    address internal admin = makeAddr("admin");
    address internal w1 = makeAddr("w1");
    address internal w2 = makeAddr("w2");
    address internal w3 = makeAddr("w3");
    address internal w4 = makeAddr("w4");
    bytes32 internal constant PERSON = keccak256("person-ref|pepper");

    function setUp() public {
        vm.warp(1_763_000_000);
        attester = vm.addr(ATTESTER_KEY);
        id = new IdentityAdapter(admin, attester);
    }

    function _sig(uint256 key, address wallet, bytes32 person, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = id.attestationDigest(wallet, person, id.nonces(wallet), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _submit(address wallet, bytes32 person) internal {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sig(ATTESTER_KEY, wallet, person, deadline);
        vm.prank(wallet);
        id.submitAttestation(wallet, person, deadline, sig);
    }

    function test_submit_linksWallet() public {
        vm.expectEmit(true, true, true, true, address(id));
        emit IdentityAdapter.Verified(w1, PERSON, attester);
        _submit(w1, PERSON);
        assertTrue(id.isVerified(w1), "verified");
        assertEq(id.personOf(w1), PERSON, "person");
        assertEq(id.personCount(), 1, "one person");
        assertEq(id.nonces(w1), 1, "nonce used");
    }

    function test_submit_replayRejected() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sig(ATTESTER_KEY, w1, PERSON, deadline);
        id.submitAttestation(w1, PERSON, deadline, sig);
        vm.prank(admin);
        id.revoke(w1);
        // same signature again: nonce moved on, so the recovered signer is not the attester
        vm.expectRevert();
        id.submitAttestation(w1, PERSON, deadline, sig);
        assertFalse(id.isVerified(w1), "stays revoked");
    }

    function test_submit_expiredRejected() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sig(ATTESTER_KEY, w1, PERSON, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(IdentityAdapter.AttestationExpired.selector);
        id.submitAttestation(w1, PERSON, deadline, sig);
    }

    function test_submit_nonAttesterRejected() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sig(0xBAD, w1, PERSON, deadline);
        vm.expectRevert(abi.encodeWithSelector(IdentityAdapter.InvalidAttester.selector, vm.addr(0xBAD)));
        id.submitAttestation(w1, PERSON, deadline, sig);
    }

    function test_submit_signatureBoundToWalletAndPerson() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sig(ATTESTER_KEY, w1, PERSON, deadline);
        vm.expectRevert(); // recovered signer differs
        id.submitAttestation(w2, PERSON, deadline, sig);
        vm.expectRevert();
        id.submitAttestation(w1, keccak256("someone else"), deadline, sig);
    }

    function test_threeWalletsOnePerson() public {
        _submit(w1, PERSON);
        _submit(w2, PERSON);
        _submit(w3, PERSON);
        assertEq(id.walletCount(PERSON), 3, "three wallets");
        assertEq(id.personCount(), 1, "still one person");

        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sig(ATTESTER_KEY, w4, PERSON, deadline);
        vm.expectRevert(abi.encodeWithSelector(IdentityAdapter.TooManyWallets.selector, PERSON));
        id.submitAttestation(w4, PERSON, deadline, sig);
    }

    function test_walletCannotSwitchPerson() public {
        _submit(w1, PERSON);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sig(ATTESTER_KEY, w1, keccak256("other"), deadline);
        vm.expectRevert(abi.encodeWithSelector(IdentityAdapter.AlreadyLinked.selector, w1));
        id.submitAttestation(w1, keccak256("other"), deadline, sig);
    }

    function test_revoke_updatesCounts() public {
        _submit(w1, PERSON);
        _submit(w2, PERSON);
        vm.prank(attester);
        id.revoke(w1);
        assertFalse(id.isVerified(w1), "revoked");
        assertEq(id.walletCount(PERSON), 1, "one left");
        assertEq(id.personCount(), 1, "person still counted");
        vm.prank(admin);
        id.revoke(w2);
        assertEq(id.personCount(), 0, "person gone");
    }

    function test_revoke_onlyAttesterOrAdmin() public {
        _submit(w1, PERSON);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, w2, id.ATTESTER_ROLE()
            )
        );
        vm.prank(w2);
        id.revoke(w1);
    }

    function test_revoke_unlinkedReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IdentityAdapter.NotLinked.selector, w1));
        vm.prank(admin);
        id.revoke(w1);
    }

    function test_attest_directPath() public {
        vm.prank(attester);
        id.attest(w1, PERSON);
        assertTrue(id.isVerified(w1), "verified");
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, w1, id.ATTESTER_ROLE()
            )
        );
        vm.prank(w1);
        id.attest(w2, PERSON);
    }

    function test_attest_rejectsZero() public {
        vm.startPrank(attester);
        vm.expectRevert(IdentityAdapter.InvalidParams.selector);
        id.attest(address(0), PERSON);
        vm.expectRevert(IdentityAdapter.InvalidParams.selector);
        id.attest(w1, bytes32(0));
        vm.stopPrank();
    }

    /// @dev Audit L-5: a signed attestation can be cancelled before the player submits it.
    function test_invalidateNonce_cancelsSignedAttestation() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sig(ATTESTER_KEY, w1, PERSON, deadline);
        vm.expectEmit(true, true, true, true, address(id));
        emit IdentityAdapter.NonceInvalidated(w1, 1, attester);
        vm.prank(attester);
        id.invalidateNonce(w1);
        vm.expectRevert();
        vm.prank(w1);
        id.submitAttestation(w1, PERSON, deadline, sig);
        assertFalse(id.isVerified(w1), "not linked");

        // admin can do it too; a fresh signature over the new nonce works
        vm.prank(admin);
        id.invalidateNonce(w2);
        _submit(w2, PERSON);
        assertTrue(id.isVerified(w2), "fresh signature links");
    }

    function test_invalidateNonce_onlyAttesterOrAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, w1, id.ATTESTER_ROLE()
            )
        );
        vm.prank(w1);
        id.invalidateNonce(w1);
    }

    /// @dev Shared EIP-712 vector (G11): the TypeScript signer (packages/core attestationTypedData)
    ///      and this contract hash the same attestation to the same digest.
    function test_golden_attestationDigest() public {
        string memory json = vm.readFile("./test/fixtures/golden-vectors.json");
        address verifying = vm.parseJsonAddress(json, ".identityAttestation.verifyingContract");
        address wallet = vm.parseJsonAddress(json, ".identityAttestation.wallet");
        bytes32 person = vm.parseJsonBytes32(json, ".identityAttestation.personHash");
        uint256 nonce = vm.parseJsonUint(json, ".identityAttestation.nonce");
        uint64 deadline = uint64(vm.parseJsonUint(json, ".identityAttestation.deadline"));
        uint256 chain = vm.parseJsonUint(json, ".identityAttestation.chainId");

        bytes32 structHash = keccak256(abi.encode(id.ATTESTATION_TYPEHASH(), wallet, person, nonce, deadline));
        assertEq(structHash, vm.parseJsonBytes32(json, ".identityAttestation.structHash"), "struct hash");
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Northeside Identity"),
                keccak256("1"),
                chain,
                verifying
            )
        );
        assertEq(
            keccak256(abi.encodePacked("\x19\x01", domain, structHash)),
            vm.parseJsonBytes32(json, ".identityAttestation.digest"),
            "digest matches TypeScript"
        );
        // and the contract's own digest uses exactly this formula for its own address and chain
        bytes32 own = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Northeside Identity"),
                keccak256("1"),
                block.chainid,
                address(id)
            )
        );
        assertEq(
            id.attestationDigest(wallet, person, nonce, deadline),
            keccak256(abi.encodePacked("\x19\x01", own, structHash)),
            "contract formula"
        );
    }
}
