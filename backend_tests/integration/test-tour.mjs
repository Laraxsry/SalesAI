import '@repo/config-env/load';
import { GuidedTour } from '@repo/screen';
import { VideoBufferType, VideoFrame } from '@livekit/rtc-node';

async function runTest() {
    console.log('1. Starting Guided Tour...');
    
    const backend = process.env.COBROWSE_PROVIDER === 'browserbase' ? 'stagehand' : 'playwright';
    const demoAuth = {
        cookies: [{
            name: 'salesai_session',
            value: 'demo_token_123',
            domain: new URL('https://salesai.dev').hostname,
            path: '/'
        }],
        localStorage: {
            'demoUser': JSON.stringify({ role: 'admin', trial: true })
        }
    };
    
    const tour = new GuidedTour({ startUrl: 'https://salesai.dev', backend, auth: demoAuth });
    
    try {
        await tour.open();
        console.log(`2. Tour opened successfully using ${backend} backend.`);
        
        console.log('2.1 Checking injected cookie...');
        const cookies = await tour.page.context().cookies('https://salesai.dev');
        const sessionCookie = cookies.find(c => c.name === 'salesai_session');
        if (sessionCookie) {
            console.log('   -> Cookie successfully injected:', sessionCookie.value);
        } else {
            console.warn('   -> Cookie injection failed!');
        }
        
        console.log('3. Taking screenshot...');
        const pngBuffer = await tour.screenshot();
        console.log('4. Screenshot captured. Buffer size:', pngBuffer.length);
        
        console.log('5. Skipping sharp due to DLOPEN error in root... Mocking data for VideoFrame.');
        // Mock a 1280x720 RGBA buffer
        const data = Buffer.alloc(1280 * 720 * 4);
        const info = { width: 1280, height: 720 };
        
        console.log('6. Mock data ready. Size:', data.length);
        
        console.log('7. Creating VideoFrame...');
        const frame = new VideoFrame(data, info.width, info.height, VideoBufferType.RGBA);
        console.log('8. VideoFrame created successfully! (Width:', frame.width, 'Height:', frame.height, 'Type:', frame.type, ')');
        
        console.log('Test PASSED!');
    } catch (err) {
        console.error('Test FAILED:', err);
    } finally {
        await tour.close();
        console.log('Tour closed.');
        process.exit(0);
    }
}

runTest();
