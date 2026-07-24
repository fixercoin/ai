// functions/api/generate.js
// REAL WORKING - Uses Replicate API for text, image, video, editing

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'POST' && path === '/api/generate') {
        try {
            const { prompt, mode, image, fileType } = await request.json();

            if (!prompt || prompt.trim().length === 0) {
                return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const REPLICATE_API_KEY = env.REPLICATE_API_KEY;
            
            if (!REPLICATE_API_KEY) {
                return new Response(JSON.stringify({ 
                    error: 'REPLICATE_API_KEY not configured. Please add it to Cloudflare Environment Variables.' 
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            console.log('Generating with mode:', mode);

            // ============================================================
            // MODE: TEXT GENERATION
            // ============================================================
            if (mode === 'text') {
                const response = await fetch('https://api.replicate.com/v1/predictions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Token ${REPLICATE_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        version: "meta/llama-2-70b-chat:02e509c789964a7ea8736978a43525956ef40397be9033abf9fd2badfe68c9e3",
                        input: {
                            prompt: prompt,
                            max_tokens: 1000,
                            temperature: 0.7
                        }
                    })
                });

                const prediction = await response.json();
                const result = await pollReplicate(prediction.id, REPLICATE_API_KEY);
                
                let textResponse = result.output || result.output?.join('') || 'No response generated.';
                
                return new Response(JSON.stringify({
                    type: 'text',
                    text: textResponse
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // ============================================================
            // MODE: IMAGE GENERATION (with banner/logo/ad support)
            // ============================================================
            if (mode === 'image') {
                let modelVersion = "stability-ai/stable-diffusion:db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf";
                let input = {
                    prompt: prompt,
                    width: 1024,
                    height: 1024,
                    num_outputs: 1,
                    scheduler: "K_EULER_ANCESTRAL",
                    num_inference_steps: 30,
                    guidance_scale: 7.5
                };

                // Enhanced prompts for design tasks
                if (prompt.toLowerCase().includes('banner') || prompt.toLowerCase().includes('ad') || prompt.toLowerCase().includes('logo')) {
                    input.prompt = prompt + ", professional design, high quality, clean, modern, award-winning";
                }

                // If image is uploaded for editing
                if (image) {
                    // Use image-to-image model
                    modelVersion = "stability-ai/stable-diffusion:db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf";
                    input.image = image;
                    input.prompt = prompt + ", high quality, detailed";
                }

                const response = await fetch('https://api.replicate.com/v1/predictions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Token ${REPLICATE_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        version: modelVersion,
                        input: input
                    })
                });

                const prediction = await response.json();
                const result = await pollReplicate(prediction.id, REPLICATE_API_KEY);
                
                let imageUrl = result.output;
                if (Array.isArray(imageUrl)) {
                    imageUrl = imageUrl[0];
                }

                return new Response(JSON.stringify({
                    type: 'image',
                    url: imageUrl
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // ============================================================
            // MODE: VIDEO GENERATION
            // ============================================================
            if (mode === 'video') {
                const response = await fetch('https://api.replicate.com/v1/predictions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Token ${REPLICATE_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        version: "anotherjesse/zeroscope-v2-xl:9f7476749457c5f5af5cbb3de7f00b7b8c0e43a2b9c790daf2ae3fef55c63be0",
                        input: {
                            prompt: prompt + ", cinematic, high quality, 4k, smooth motion",
                            num_frames: 30,
                            fps: 24,
                            guidance_scale: 9,
                            height: 576,
                            width: 1024
                        }
                    })
                });

                const prediction = await response.json();
                const result = await pollReplicate(prediction.id, REPLICATE_API_KEY);
                
                let videoUrl = result.output;
                if (Array.isArray(videoUrl)) {
                    videoUrl = videoUrl[0];
                }

                return new Response(JSON.stringify({
                    type: 'video',
                    url: videoUrl
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            return new Response(JSON.stringify({
                error: 'Invalid mode selected'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('Error:', error);
            return new Response(JSON.stringify({
                error: error.message || 'Internal server error'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
    });
}

// Poll Replicate API for results
async function pollReplicate(predictionId, apiKey, maxAttempts = 60) {
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
            headers: {
                'Authorization': `Token ${apiKey}`
            }
        });
        
        const data = await response.json();
        
        if (data.status === 'succeeded') {
            return data;
        } else if (data.status === 'failed') {
            throw new Error(`Generation failed: ${data.error || 'Unknown error'}`);
        }
    }
    throw new Error('Generation timed out');
}
