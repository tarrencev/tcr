pragma solidity ^0.4.11;

import "tokens/eip20/EIP20.sol";
import "./Parameterizer.sol";
import "./PLCRVoting.sol";

contract Registry {

    // ------
    // EVENTS
    // ------

    event _Application(address member, uint deposit, string data);
    event _Challenge(address member, uint deposit, uint pollID, string data);
    event _Deposit(address member, uint added, uint newTotal);
    event _Withdrawal(address member, uint withdrew, uint newTotal);
    event _NewMemberWhitelisted(address member);
    event _ApplicationRemoved(address member);
    event _MemberRemoved(address member);
    event _ChallengeFailed(uint challengeID);
    event _ChallengeSucceeded(uint challengeID);
    event _RewardClaimed(address voter, uint challengeID, uint reward);

    // ------
    // DATA STRUCTURES
    // ------

    struct Member {
        uint applicationExpiry; // Expiration date of apply stage
        bool whitelisted;       // Indicates registry status
        uint unstakedDeposit;   // Number of tokens in the member not locked in a challenge
        uint challengeID;       // Corresponds to a PollID in PLCRVoting
    }

    struct Challenge {
        uint rewardPool;        // (remaining) Pool of tokens to be distributed to winning voters
        address challenger;     // Owner of Challenge
        bool resolved;          // Indication of if challenge is resolved
        uint stake;             // Number of tokens at stake for either party during challenge
        uint totalTokens;       // (remaining) Number of tokens used in voting by the winning side
        mapping(address => bool) voterCanClaimReward; // Indicates whether a voter has claimed a reward yet
    }

    // ------
    // STATE
    // ------

    Registry masterCopy; // THIS MUST ALWAYS BE THE FIRST STATE VARIABLE DECLARED!!!!!!

    // Maps challengeIDs to associated challenge data
    mapping(uint => Challenge) public challenges;

    // Maps memberes to associated member data
    mapping(address => Member) public members;

    // Global Variables
    EIP20 public token;
    PLCRVoting public voting;
    Parameterizer public parameterizer;

    string public version = '1';
    string public name;

    // ------------
    // CONSTRUCTOR:
    // ------------

    /**
    @dev Contructor         Sets the addresses for token, voting, and parameterizer
    @param _tokenAddr       Address of the TCR's intrinsic ERC20 token
    @param _plcrAddr        Address of a PLCR voting contract for the provided token
    @param _paramsAddr      Address of a Parameterizer contract
    */
    function Registry(
        address _tokenAddr,
        address _plcrAddr,
        address _paramsAddr,
        string _name
    ) public {
      setup(_tokenAddr, _plcrAddr, _paramsAddr, _name);
    }

    function setup(
        address _tokenAddr,
        address _plcrAddr,
        address _paramsAddr,
        string _name
    ) public {
        require(address(token) == 0);

        token = EIP20(_tokenAddr);
        voting = PLCRVoting(_plcrAddr);
        parameterizer = Parameterizer(_paramsAddr);
        name = _name;
    }

    // --------------------
    // PUBLISHER INTERFACE:
    // --------------------

    /**
    @dev                Allows a user to start an application for membership. Takes tokens from user and sets
                        apply stage end time.
    @param _amount      The number of ERC20 tokens a user is willing to potentially stake
    @param _data        Extra data relevant to the application. Think IPFS hashes.
    */
    function apply(uint _amount, string _data) external {
        require(!isWhitelisted(msg.sender));
        require(!appWasMade(msg.sender));
        require(_amount >= parameterizer.get("minDeposit"));

        // Sets owner
        Member storage member = members[msg.sender];

        // Transfers tokens from user to Registry contract
        require(token.transferFrom(msg.sender, this, _amount));

        // Sets apply stage end time
        member.applicationExpiry = block.timestamp + parameterizer.get("applyStageLen");
        member.unstakedDeposit = _amount;

        _Application(msg.sender, _amount, _data);
    }

    /**
    @dev                Allows a member to increase their unstaked deposit.
    @param _amount      The number of ERC20 tokens to increase a members's unstaked deposit
    */
    function deposit(uint _amount) external {
        Member storage member = members[msg.sender];

        require(token.transferFrom(msg.sender, this, _amount));

        member.unstakedDeposit += _amount;

        _Deposit(msg.sender, _amount, member.unstakedDeposit);
    }

    /**
    @dev                Allows a member to decrease their unstaked deposit.
    @param _amount      The number of ERC20 tokens to withdraw from the unstaked deposit.
    */
    function withdraw(uint _amount) external {
        Member storage member = members[msg.sender];

        require(_amount <= member.unstakedDeposit);
        require(member.unstakedDeposit - _amount >= parameterizer.get("minDeposit"));

        require(token.transfer(msg.sender, _amount));

        member.unstakedDeposit -= _amount;

        _Withdrawal(msg.sender, _amount, member.unstakedDeposit);
    }

    /**
    @dev                Allows a member to remove themself from the whitelist
                        Returns all tokens to the member
    */
    function exit() external {
        Member storage member = members[msg.sender];

        require(isWhitelisted(msg.sender));

        // Cannot exit during ongoing challenge
        require(member.challengeID == 0 || challenges[member.challengeID].resolved);

        // Remove member & return tokens
        resetMember(msg.sender);

        _MemberRemoved(msg.sender);
    }

    // -----------------------
    // TOKEN HOLDER INTERFACE:
    // -----------------------

    /**
    @dev                Starts a poll for a member which is either in the apply stage or
                        already in the whitelist. Tokens are taken from the challenger and the
                        applicant's deposits are locked.
    @param _member        User being challenged
    @param _data        Extra data relevant to the challenge. Think IPFS hashes.
    */
    function challenge(address _member, string _data) external returns (uint challengeID) {
        Member storage member = members[_member];
        uint deposit = parameterizer.get("minDeposit");

        // Member must be in apply stage or already on the whitelist
        require(appWasMade(_member) || member.whitelisted);
        // Prevent multiple challenges
        require(member.challengeID == 0 || challenges[member.challengeID].resolved);

        if (member.unstakedDeposit < deposit) {
            // Not enough tokens, member auto-delisted
            resetMember(_member);
            return 0;
        }

        // Takes tokens from challenger
        require(token.transferFrom(msg.sender, this, deposit));

        // Starts poll
        uint pollID = voting.startPoll(
            parameterizer.get("voteQuorum"),
            parameterizer.get("commitStageLen"),
            parameterizer.get("revealStageLen")
        );

        challenges[pollID] = Challenge({
            challenger: msg.sender,
            rewardPool: ((100 - parameterizer.get("dispensationPct")) * deposit) / 100,
            stake: deposit,
            resolved: false,
            totalTokens: 0
        });

        // Updates member to store most recent challenge
        member.challengeID = pollID;

        // Locks tokens for member during challenge
        member.unstakedDeposit -= deposit;

        _Challenge(_member, deposit, pollID, _data);
        return pollID;
    }

    /**
    @dev                Updates a members status from 'application' to 'member' or resolves
                        a challenge if one exists.
    */
    function updateStatus() public {
        if (canBeWhitelisted(msg.sender)) {
          whitelistApplication(msg.sender);
          _NewMemberWhitelisted(msg.sender);
        } else if (challengeCanBeResolved(msg.sender)) {
          resolveChallenge(msg.sender);
        } else {
          revert();
        }
    }

    // ----------------
    // TOKEN FUNCTIONS:
    // ----------------

    /**
    @dev                Called by a voter to claim their reward for each completed vote. Someone
                        must call updateStatus() before this can be called.
    @param _challengeID The PLCR pollID of the challenge a reward is being claimed for
    @param _salt        The salt of a voter's commit hash in the given poll
    */
    function claimVoterReward(uint _challengeID, uint _salt) public {
        // Ensures the voter has not already claimed tokens and challenge results have been processed
        require(challenges[_challengeID].voterCanClaimReward[msg.sender] == false);
        require(challenges[_challengeID].resolved == true);

        uint voterTokens = voting.getNumPassingTokens(msg.sender, _challengeID, _salt);
        uint reward = voterReward(msg.sender, _challengeID, _salt);

        // Subtracts the voter's information to preserve the participation ratios
        // of other voters compared to the remaining pool of rewards
        challenges[_challengeID].totalTokens -= voterTokens;
        challenges[_challengeID].rewardPool -= reward;

        require(token.transfer(msg.sender, reward));

        // Ensures a voter cannot claim tokens again
        challenges[_challengeID].voterCanClaimReward[msg.sender] = true;

        _RewardClaimed(msg.sender, _challengeID, reward);
    }

    // --------
    // GETTERS:
    // --------

    /**
    @dev                Calculates the provided voter's token reward for the given poll.
    @param _voter       The address of the voter whose reward balance is to be returned
    @param _challengeID The pollID of the challenge a reward balance is being queried for
    @param _salt        The salt of the voter's commit hash in the given poll
    @return             The uint indicating the voter's reward
    */
    function voterReward(address _voter, uint _challengeID, uint _salt)
    public view returns (uint) {
        uint totalTokens = challenges[_challengeID].totalTokens;
        uint rewardPool = challenges[_challengeID].rewardPool;
        uint voterTokens = voting.getNumPassingTokens(_voter, _challengeID, _salt);
        return (voterTokens * rewardPool) / totalTokens;
    }

    /**
    @dev                Determines whether the given user be whitelisted.
    @param _member      The member whose status is to be examined
    */
    function canBeWhitelisted(address _member) view public returns (bool) {
        uint challengeID = members[_member].challengeID;

        // Ensures that the application was made,
        // the application period has ended,
        // the member can be whitelisted,
        // and either: the challengeID == 0, or the challenge has been resolved.
        if (
            appWasMade(_member) &&
            members[_member].applicationExpiry < now &&
            !isWhitelisted(_member) &&
            (challengeID == 0 || challenges[challengeID].resolved == true)
        ) { return true; }

        return false;
    }

    /**
    @dev                Returns true if the provided user is whitelisted
    @param _member      The member being examined
    */
    function isWhitelisted(address _member) view public returns (bool whitelisted) {
        return members[_member].whitelisted;
    }

    /**
    @dev                Returns true if apply was called for this member
    @param _member      The member being examined
    */
    function appWasMade(address _member) view public returns (bool exists) {
        return members[_member].applicationExpiry > 0;
    }

    /**
    @dev                Returns true if the application/member has an unresolved challenge
    @param _member      The member being examined
    */
    function challengeExists(address _member) view public returns (bool) {
        uint challengeID = members[_member].challengeID;

        return (members[_member].challengeID > 0 && !challenges[challengeID].resolved);
    }

    /**
    @dev                Determines whether voting has concluded in a challenge for a given
                        member. Throws if no challenge exists.
    @param _member      The member being examined
    */
    function challengeCanBeResolved(address _member) view public returns (bool) {
        uint challengeID = members[_member].challengeID;

        require(challengeExists(_member));

        return voting.pollEnded(challengeID);
    }

    /**
    @dev                Determines the number of tokens awarded to the winning party in a challenge.
    @param _challengeID The challengeID to determine a reward for
    */
    function challengeWinnerReward(uint _challengeID) public view returns (uint) {
        require(!challenges[_challengeID].resolved && voting.pollEnded(_challengeID));

        // Edge case, nobody voted, give all tokens to the challenger.
        if (voting.getTotalNumberOfTokensForWinningOption(_challengeID) == 0) {
            return 2 * challenges[_challengeID].stake;
        }

        return (2 * challenges[_challengeID].stake) - challenges[_challengeID].rewardPool;
    }

    /**
    @dev                Getter for Challenge voterCanClaimReward mappings
    @param _challengeID The challengeID to query
    @param _voter       The voter whose claim status to query for the provided challengeID
    */
    function voterCanClaimReward(uint _challengeID, address _voter) public view returns (bool) {
      return challenges[_challengeID].voterCanClaimReward[_voter];
    }

    // ----------------
    // PRIVATE FUNCTIONS:
    // ----------------

    /**
    @dev                Determines the winner in a challenge. Rewards the winner tokens and
                        either whitelists or de-whitelists the member.
    @param _member      The member being examined
    */
    function resolveChallenge(address _member) private {
        uint challengeID = members[_member].challengeID;

        // Calculates the winner's reward,
        // which is: (winner's full stake) + (dispensationPct * loser's stake)
        uint reward = challengeWinnerReward(challengeID);

        // Records whether the member is a member or an application
        bool wasWhitelisted = isWhitelisted(_member);

        // Case: challenge failed
        if (voting.isPassed(challengeID)) {
            whitelistApplication(_member);
            // Unlock stake so that it can be retrieved by the applicant
            members[_member].unstakedDeposit += reward;

            _ChallengeFailed(challengeID);
            if (!wasWhitelisted) { _NewMemberWhitelisted(_member); }
        }
        // Case: challenge succeeded
        else {
            resetMember(_member);
            // Transfer the reward to the challenger
            require(token.transfer(challenges[challengeID].challenger, reward));

            _ChallengeSucceeded(challengeID);
            if (wasWhitelisted) { _MemberRemoved(_member); }
            else { _ApplicationRemoved(_member); }
        }

        // Sets flag on challenge being processed
        challenges[challengeID].resolved = true;

        // Stores the total tokens used for voting by the winning side for reward purposes
        challenges[challengeID].totalTokens =
            voting.getTotalNumberOfTokensForWinningOption(challengeID);
    }

    /**
    @dev                Called by updateStatus() if the applicationExpiry date passed without a
                        challenge being made. Called by resolveChallenge() if an
                        application/member beat a challenge.
    @param _member      The member being examined
    */
    function whitelistApplication(address _member) private {
        members[_member].whitelisted = true;
    }

    /**
    @dev                Deletes a member from the whitelist and transfers tokens back to owner
    @param _member      The member being reset
    */
    function resetMember(address _member) private {
        Member storage member = members[_member];

        // Transfers any remaining balance back to the owner
        if (member.unstakedDeposit > 0)
            require(token.transfer(_member, member.unstakedDeposit));

        delete members[_member];
    }
}
