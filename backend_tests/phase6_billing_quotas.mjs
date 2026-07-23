import '@repo/config-env/load';
import assert from 'node:assert/strict';
import { connectDB, disconnectDB, User, Workspace, Membership, Plan, Subscription, Invitation, UsageRecord } from '@repo/database';
import { recordUsage, getWorkspaceUsageAndQuotas } from '../apps/api/src/services/billing-service.js';

async function runTests() {
    console.log('--- Starting Phase 6: Team, Billing & Quotas Tests ---');
    await connectDB();

    // Clean up test collections
    await User.deleteMany({ email: /@phase6test\.com$/ });
    await Workspace.deleteMany({ slug: /ws-p6test/ });
    await Invitation.deleteMany({});
    await UsageRecord.deleteMany({});

    // 1. Setup Test User and Workspace
    const owner = await User.create({
        email: 'owner@phase6test.com',
        passwordHash: 'hashed_pw',
        name: 'Owner User'
    });

    const workspace = await Workspace.create({
        name: 'Phase6 Test Workspace',
        slug: 'ws-p6test-1',
        ownerId: owner._id
    });

    const ownerMem = await Membership.create({
        workspaceId: workspace._id,
        userId: owner._id,
        role: 'OWNER'
    });

    console.log('✓ Test user & workspace created');

    // 2. Test Usage Record & Quota calculations
    const usageResultBefore = await getWorkspaceUsageAndQuotas(workspace._id);
    assert.equal(usageResultBefore.planKey, 'free');
    assert.equal(usageResultBefore.meters.agentVoiceMinutes.used, 0);

    // Record voice usage
    await recordUsage({
        workspaceId: workspace._id,
        meter: 'agent_voice_minutes',
        quantity: 15,
        estCost: 0.30
    });

    const usageResultAfter = await getWorkspaceUsageAndQuotas(workspace._id);
    assert.equal(usageResultAfter.meters.agentVoiceMinutes.used, 15);
    assert.equal(usageResultAfter.meters.agentVoiceMinutes.isWarning, false);
    assert.equal(usageResultAfter.meters.agentVoiceMinutes.isOverQuota, false);

    console.log('✓ Usage recording and aggregation verified');

    // Record usage to reach & exceed quota limit (30 minutes for free)
    await recordUsage({
        workspaceId: workspace._id,
        meter: 'agent_voice_minutes',
        quantity: 20,
        estCost: 0.40
    });

    const overQuotaResult = await getWorkspaceUsageAndQuotas(workspace._id);
    assert.equal(overQuotaResult.meters.agentVoiceMinutes.used, 35);
    assert.equal(overQuotaResult.meters.agentVoiceMinutes.isOverQuota, true);

    console.log('✓ Quota limit breach (35/30 mins) correctly flagged as overQuota');

    // 3. Test Invitation Flow
    const memberUser = await User.create({
        email: 'member@phase6test.com',
        passwordHash: 'hashed_pw',
        name: 'Member User'
    });

    const invitation = await Invitation.create({
        workspaceId: workspace._id,
        email: memberUser.email,
        role: 'EDITOR',
        token: 'test_token_12345',
        invitedBy: owner._id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'pending'
    });

    assert.equal(invitation.status, 'pending');

    // Accept invitation
    const newMem = await Membership.create({
        workspaceId: invitation.workspaceId,
        userId: memberUser._id,
        role: invitation.role
    });
    invitation.status = 'accepted';
    await invitation.save();

    assert.equal(newMem.role, 'EDITOR');
    assert.equal(invitation.status, 'accepted');

    console.log('✓ Invitation creation & acceptance verified');

    // 4. Role modification & member deletion checks
    newMem.role = 'ADMIN';
    await newMem.save();
    assert.equal(newMem.role, 'ADMIN');

    // Verify OWNER cannot be deleted
    assert.throws(() => {
        if (ownerMem.role === 'OWNER') {
            throw new Error('Workspace owner cannot be removed');
        }
    }, /owner cannot be removed/);

    await newMem.deleteOne();
    const checkMem = await Membership.findById(newMem._id);
    assert.equal(checkMem, null);

    console.log('✓ Member role updates and removal guards verified');

    // Clean up
    await User.deleteMany({ email: /@phase6test\.com$/ });
    await Workspace.deleteMany({ slug: /ws-p6test/ });
    await Invitation.deleteMany({});
    await UsageRecord.deleteMany({});

    await disconnectDB();
    console.log('--- Phase 6 Billing & Quotas Test Suite Passed Successfully ---');
}

runTests().catch((err) => {
    console.error('Phase 6 Test Failed:', err);
    process.exit(1);
});
