// functions/api/generate.js
// Updated to support IMAGE, VIDEO, and VOICE modes

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // Only handle POST /api/generate
    if (request.method === 'POST' && path === '/api/generate') {
        try {
            if (!env.AI) {
                return new Response(JSON.stringify({ 
                    error: 'AI binding not found. Please add AI binding in Cloudflare Dashboard.' 
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const { prompt, mode } = await request.json();

            if (!prompt || prompt.trim().length === 0) {
                return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Log the request
            console.log('Generating with:', { prompt, mode });

            // ============================================================
            // HANDLE DIFFERENT MODES
            // ============================================================
            
            // Default to image generation
            let responseData = {
                type: 'image',
                url: null
            };

            // If mode is 'voice', we just use the transcribed text (already in prompt)
            // The voice transcription happens on the frontend, so we just generate image/video
            // based on the transcribed prompt

            // ============================================================
            // GENERATE IMAGE using Cloudflare Workers AI
            // ============================================================
            const model = '@cf/black-forest-labs/flux-1-schnell';
            
            let genParams = {
                prompt: prompt,
                width: 1024,
                height: 1024
            };

            // For video mode, we still generate an image first
            // (Cloudflare Workers AI doesn't directly generate videos yet)
            // The frontend will display it as video type
            if (mode === 'video') {
                genParams.prompt = prompt + ", cinematic, high quality, 4k";
            }

            const aiResponse = await env.AI.run(model, genParams);

            let imageUrl = null;

            // ============================================================
            // EXTRACT IMAGE URL FROM RESPONSE
            // ============================================================

            // If response is a string
            if (typeof aiResponse === 'string') {
                if (aiResponse.startsWith('data:image')) {
                    imageUrl = aiResponse;
                } else if (aiResponse.startsWith('/9j/') || aiResponse.match(/^[A-Za-z0-9+/=]+$/)) {
                    imageUrl = `data:image/jpeg;base64,${aiResponse}`;
                } else if (aiResponse.startsWith('http://') || aiResponse.startsWith('https://')) {
                    imageUrl = aiResponse;
                } else {
                    try {
                        const parsed = JSON.parse(aiResponse);
                        if (parsed.image) {
                            let imgData = parsed.image;
                            if (typeof imgData === 'string' && !imgData.startsWith('data:image') && !imgData.startsWith('http')) {
                                imgData = `data:image/jpeg;base64,${imgData}`;
                            }
                            imageUrl = imgData;
                        } else if (parsed.url) {
                            imageUrl = parsed.url;
                        } else if (parsed.data) {
                            imageUrl = `data:image/jpeg;base64,${parsed.data}`;
                        }
                    } catch (e) {
                        console.log('Could not parse response as JSON');
                    }
                }
            } 
            // If response is an object
            else if (typeof aiResponse === 'object' && aiResponse !== null) {
                if (aiResponse.image) {
                    let imgData = aiResponse.image;
                    if (typeof imgData === 'string' && !imgData.startsWith('data:image') && !imgData.startsWith('http')) {
                        imgData = `data:image/jpeg;base64,${imgData}`;
                    }
                    imageUrl = imgData;
                } else if (aiResponse.url) {
                    imageUrl = aiResponse.url;
                } else if (aiResponse.data) {
                    imageUrl = `data:image/jpeg;base64,${aiResponse.data}`;
                } else if (aiResponse.output) {
                    if (Array.isArray(aiResponse.output) && aiResponse.output.length > 0) {
                        let out = aiResponse.output[0];
                        if (typeof out === 'string' && !out.startsWith('data:image') && !out.startsWith('http')) {
                            out = `data:image/jpeg;base64,${out}`;
                        }
                        imageUrl = out;
                    } else if (typeof aiResponse.output === 'string') {
                        let out = aiResponse.output;
                        if (!out.startsWith('data:image') && !out.startsWith('http')) {
                            out = `data:image/jpeg;base64,${out}`;
                        }
                        imageUrl = out;
                    }
                } else if (aiResponse.results && Array.isArray(aiResponse.results) && aiResponse.results.length > 0) {
                    const result = aiResponse.results[0];
                    if (result) {
                        if (result.image) {
                            let imgData = result.image;
                            if (typeof imgData === 'string' && !imgData.startsWith('data:image') && !imgData.startsWith('http')) {
                                imgData = `data:image/jpeg;base64,${imgData}`;
                            }
                            imageUrl = imgData;
                        } else if (result.url) {
                            imageUrl = result.url;
                        } else if (result.data) {
                            imageUrl = `data:image/jpeg;base64,${result.data}`;
                        }
                    }
                }
            }

            // ============================================================
            // FALLBACK: Try bytes conversion
            // ============================================================
            if (!imageUrl) {
                try {
                    let arrayBuffer;
                    if (aiResponse instanceof ReadableStream) {
                        arrayBuffer = await new Response(aiResponse).arrayBuffer();
                    } else if (aiResponse instanceof ArrayBuffer) {
                        arrayBuffer = aiResponse;
                    } else if (aiResponse && typeof aiResponse === 'object' && aiResponse.bytes) {
                        arrayBuffer = aiResponse.bytes;
                    } else if (aiResponse && typeof aiResponse === 'object' && aiResponse.buffer) {
                        arrayBuffer = aiResponse.buffer;
                    }

                    if (arrayBuffer) {
                        const bytes = new Uint8Array(arrayBuffer);
                        let binary = '';
                        for (let i = 0; i < bytes.length; i++) {
                            binary += String.fromCharCode(bytes[i]);
                        }
                        const base64 = btoa(binary);
                        imageUrl = `data:image/jpeg;base64,${base64}`;
                    }
                } catch (e) {
                    console.error('Bytes conversion error:', e);
                }
            }

            // ============================================================
            // FINAL URL FIX
            // ============================================================
            if (!imageUrl) {
                return new Response(JSON.stringify({
                    error: 'Could not generate image. Please try again.'
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            if (typeof imageUrl === 'string' && !imageUrl.startsWith('data:image') && !imageUrl.startsWith('http')) {
                if (imageUrl.startsWith('/9j/')) {
                    imageUrl = `data:image/jpeg;base64,${imageUrl}`;
                } else {
                    imageUrl = `data:image/jpeg;base64,${imageUrl}`;
                }
            }

            // ============================================================
            // SET RESPONSE TYPE BASED ON MODE
            // ============================================================
            if (mode === 'video') {
                responseData.type = 'video';
            } else {
                responseData.type = 'image';
            }
            
            responseData.url = imageUrl;

            // ============================================================
            // RETURN RESPONSE
            // ============================================================
            return new Response(JSON.stringify(responseData), {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });

        } catch (error) {
            console.error('Generation error:', error);
            return new Response(JSON.stringify({
                error: error.message || 'Internal server error'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // ============================================================
    // 404 - Not found
    // ============================================================
    return new Response(JSON.stringify({ 
        error: 'Not found',
        path: path,
        method: request.method
    }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
    });
}
