// functions/api/generate.js
// Supports TEXT, IMAGE, and VIDEO generation

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

            const { prompt, mode, image, fileType } = await request.json();

            if (!prompt || prompt.trim().length === 0) {
                return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            console.log('Generating with:', { prompt, mode, hasImage: !!image });

            // ============================================================
            // MODE 1: TEXT GENERATION
            // ============================================================
            if (mode === 'text') {
                try {
                    // Use a text generation model
                    const textModel = '@cf/meta/llama-2-7b-chat-int8';
                    const textResponse = await env.AI.run(textModel, {
                        prompt: prompt,
                        max_tokens: 500
                    });

                    let responseText = '';
                    if (typeof textResponse === 'string') {
                        responseText = textResponse;
                    } else if (typeof textResponse === 'object' && textResponse !== null) {
                        responseText = textResponse.response || textResponse.message || textResponse.text || JSON.stringify(textResponse);
                    } else {
                        responseText = 'Sorry, I could not generate a response. Please try again.';
                    }

                    return new Response(JSON.stringify({
                        type: 'text',
                        text: responseText
                    }), {
                        status: 200,
                        headers: { 
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        }
                    });
                } catch (textError) {
                    console.error('Text generation error:', textError);
                    return new Response(JSON.stringify({
                        type: 'text',
                        text: 'I encountered an error while generating a response. Please try again.'
                    }), {
                        status: 200,
                        headers: { 
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        }
                    });
                }
            }

            // ============================================================
            // MODE 2: IMAGE GENERATION
            // ============================================================
            const model = '@cf/black-forest-labs/flux-1-schnell';
            
            let genParams = {
                prompt: prompt,
                width: 1024,
                height: 1024
            };

            // Enhance prompt for video mode
            if (mode === 'video') {
                genParams.prompt = prompt + ", cinematic, high quality, 4k";
            }

            const aiResponse = await env.AI.run(model, genParams);

            let imageUrl = null;

            // Extract image URL from response
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
                    } catch (e) {}
                }
            } else if (typeof aiResponse === 'object' && aiResponse !== null) {
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

            // Fallback: bytes conversion
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
                } catch (e) {}
            }

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

            return new Response(JSON.stringify({
                type: mode === 'video' ? 'video' : 'image',
                url: imageUrl
            }), {
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

    return new Response(JSON.stringify({ 
        error: 'Not found'
    }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
    });
}
