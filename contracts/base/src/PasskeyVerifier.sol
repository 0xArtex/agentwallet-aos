// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title PasskeyVerifier
 * @notice Verifies WebAuthn/passkey P-256 signatures using the RIP-7212 precompile.
 * @dev The precompile at 0x100 verifies secp256r1 (P-256) signatures.
 *      Available on Base mainnet and Base Sepolia.
 */
library PasskeyVerifier {
    // Daimo's audited P256Verifier — deployed at deterministic CREATE2 address on all EVM chains
    // Falls back from RIP-7212 precompile to pure Solidity verification
    address constant P256_VERIFIER = 0xc2b78104907F722DABAc4C69f826a522B2754De4;

    /**
     * @notice Verify a P-256 signature.
     * @param messageHash The hash of the signed message
     * @param r Signature r component
     * @param s Signature s component  
     * @param pubKeyX Public key x coordinate
     * @param pubKeyY Public key y coordinate
     * @return True if signature is valid
     */
    function verifySignature(
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        bytes32 pubKeyX,
        bytes32 pubKeyY
    ) internal view returns (bool) {
        // RIP-7212 precompile input: hash(32) || r(32) || s(32) || x(32) || y(32)
        bytes memory input = abi.encodePacked(messageHash, r, s, pubKeyX, pubKeyY);
        
        (bool success, bytes memory result) = P256_VERIFIER.staticcall(input);
        
        if (!success || result.length == 0) return false;
        
        // Precompile returns 1 for valid signature
        return abi.decode(result, (uint256)) == 1;
    }

    /**
     * @notice Verify a WebAuthn assertion signature.
     * @dev Reconstructs the signed message from authenticatorData + clientDataJSON,
     *      then verifies the P-256 signature.
     * @param authenticatorData Raw authenticator data from WebAuthn
     * @param clientDataJSON Client data JSON string
     * @param r Signature r
     * @param s Signature s
     * @param pubKeyX Public key x
     * @param pubKeyY Public key y
     */
    function verifyWebAuthn(
        bytes calldata authenticatorData,
        string calldata clientDataJSON,
        bytes32 r,
        bytes32 s,
        bytes32 pubKeyX,
        bytes32 pubKeyY
    ) internal view returns (bool) {
        // WebAuthn signature is over: SHA256(authenticatorData || SHA256(clientDataJSON))
        bytes32 clientDataHash = sha256(bytes(clientDataJSON));
        bytes32 messageHash = sha256(abi.encodePacked(authenticatorData, clientDataHash));
        
        return verifySignature(messageHash, r, s, pubKeyX, pubKeyY);
    }
}
