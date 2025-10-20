pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract BiodiversityCreditFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosedOrDoesNotExist();
    error InvalidParameter();
    error ReplayDetected();
    error StateMismatch();
    error DecryptionFailed();

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    struct Batch {
        bool isOpen;
        uint256 totalEncryptedScore;
        uint256 submissionCount;
    }

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => mapping(address => bool)) public hasSubmittedToBatch;

    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId, uint256 totalEncryptedScore, uint256 submissionCount);
    event DataSubmitted(address indexed provider, uint256 indexed batchId, euint32 encryptedScore);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 batchId, uint256 decryptedScore, uint256 submissionCount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        cooldownSeconds = 60; // Default cooldown
        currentBatchId = 1;
        _openBatch(currentBatchId);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (provider == address(0)) revert InvalidParameter();
        isProvider[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        if (provider == address(0)) revert InvalidParameter();
        isProvider[provider] = false;
        emit ProviderRemoved(provider);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert Paused();
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        if (newCooldownSeconds == 0) revert InvalidParameter();
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        _openBatch(currentBatchId);
    }

    function _openBatch(uint256 batchId) private {
        batches[batchId] = Batch({isOpen: true, totalEncryptedScore: 0, submissionCount: 0});
        emit BatchOpened(batchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner whenNotPaused {
        if (!batches[batchId].isOpen) revert BatchClosedOrDoesNotExist();
        batches[batchId].isOpen = false;
        emit BatchClosed(batchId, batches[batchId].totalEncryptedScore, batches[batchId].submissionCount);
    }

    function submitData(uint256 batchId, euint32 encryptedScore) external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) revert CooldownActive();
        if (!batches[batchId].isOpen) revert BatchClosedOrDoesNotExist();
        if (hasSubmittedToBatch[batchId][msg.sender]) revert InvalidParameter(); // Cannot submit twice to same batch

        _initIfNeeded(encryptedScore);

        batches[batchId].totalEncryptedScore = FHE.add(
            FHE.asEuint32(batches[batchId].totalEncryptedScore),
            encryptedScore
        ).val;
        batches[batchId].submissionCount++;
        hasSubmittedToBatch[batchId][msg.sender] = true;
        lastSubmissionTime[msg.sender] = block.timestamp;

        emit DataSubmitted(msg.sender, batchId, encryptedScore);
    }

    function requestBatchScoreDecryption(uint256 batchId) external onlyOwner whenNotPaused {
        if (batches[batchId].submissionCount == 0) revert InvalidParameter(); // Nothing to decrypt
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) revert CooldownActive();

        euint32 encryptedTotalScore = FHE.asEuint32(batches[batchId].totalEncryptedScore);
        _initIfNeeded(encryptedTotalScore);

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedTotalScore);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        emit DecryptionRequested(requestId, batchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();
        // Security: Replay protection ensures a decryption request is processed only once.

        uint256 batchId = decryptionContexts[requestId].batchId;
        euint32 encryptedTotalScore = FHE.asEuint32(batches[batchId].totalEncryptedScore);
        _initIfNeeded(encryptedTotalScore);

        bytes32[] memory currentCts = new bytes32[](1);
        currentCts[0] = FHE.toBytes32(encryptedTotalScore);
        bytes32 currentStateHash = _hashCiphertexts(currentCts);

        // Security: State hash verification ensures that the ciphertexts being decrypted
        // correspond to the exact state of the contract when decryption was requested.
        // This prevents scenarios where the underlying data changes after the request but before decryption.
        if (currentStateHash != decryptionContexts[requestId].stateHash) revert StateMismatch();

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert DecryptionFailed();

        uint256 decryptedScore = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;

        emit DecryptionCompleted(requestId, batchId, decryptedScore, batches[batchId].submissionCount);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 val) internal {
        if (!FHE.isInitialized(val)) {
            FHE.asEuint32(0); // Initialize with a dummy value if not already initialized
        }
    }

    function _requireInitialized(euint32 val) internal view {
        if (!FHE.isInitialized(val)) revert InvalidParameter();
    }
}