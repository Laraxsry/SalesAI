import '@repo/config-env/load';
import { connectDB, Session, Agent, ShareLink, Product } from '@repo/database';
import mongoose from 'mongoose';

async function runTest() {
    await connectDB();

    console.log('Test 1: Creating Product, Agent, and ShareLink');
    const User = mongoose.model('User');
    const user = await User.create({ email: 'test@test.com', name: 'Test', passwordHash: 'abc' });
    const Workspace = mongoose.model('Workspace');
    const workspace = await Workspace.create({ ownerId: user._id, name: 'Test WS', slug: 'test-ws-' + Date.now(), stripeCustomerId: 'cus_123' });
    const product = await Product.create({ workspaceId: workspace._id, name: 'Test Product', websiteUrl: 'https://example.com' });
    const agent = await Agent.create({ productId: product._id, name: 'Test Agent', status: 'active' });
    const link = await ShareLink.create({ agentId: agent._id, token: 'test-token-' + Date.now() });

    console.log('Test 2: Creating Session with transientAuth');
    const mockCookies = [{ name: 'sessionid', value: '12345', domain: 'example.com', path: '/' }];
    const mockLocalStorage = { 'user_token': 'abc' };
    
    const session = await Session.create({
        agentId: agent._id,
        shareLinkId: link._id,
        roomName: 'test-room',
        status: 'live',
        source: 'link',
        transientAuth: { cookies: mockCookies, localStorage: mockLocalStorage }
    });

    console.log('Session created with transientAuth:', session.transientAuth);
    if (!session.transientAuth || !session.transientAuth.cookies || session.transientAuth.cookies[0].name !== 'sessionid') {
        throw new Error('Failed to save transientAuth to Session');
    }

    console.log('Test 3: Simulating Agent Worker deleting transientAuth (Single-Use)');
    await Session.updateOne({ _id: session._id }, { $unset: { transientAuth: 1 } });
    
    const updatedSession = await Session.findById(session._id);
    if (updatedSession.transientAuth) {
        throw new Error('Failed to delete transientAuth from Session');
    }

    console.log('Success! Session Handover tests passed.');
    
    // Cleanup
    await Session.deleteOne({ _id: session._id });
    await ShareLink.deleteOne({ _id: link._id });
    await Agent.deleteOne({ _id: agent._id });
    await Product.deleteOne({ _id: product._id });
    await Workspace.deleteOne({ _id: workspace._id });
    await User.deleteOne({ _id: user._id });
    
    mongoose.connection.close();
}

runTest().catch(console.error);
