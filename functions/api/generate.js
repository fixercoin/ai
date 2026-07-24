// functions/api/generate.js
// Fixed image display with proper data handling

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    console.log('Request path:', path);
    console.log('Method:', request.method);
    console.log('AI binding exists:', !!env.AI);
    console.log('KV binding exists:', !!env.GENERATIONS);

    // ============================================================
    // ENDPOINT 1: GET /api/history - Fetch all history
    // ============================================================
    if (request.method === 'GET' && path === '/api/history') {
        try {
            if (!env.GENERATIONS) {
                return new Response(JSON.stringify({ 
                    items: [],
                    message: 'History storage is not available'
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            let historyList = [];
            const historyData = await env.GENERATIONS.get('history_list');
            if (historyData) {
                historyList = JSON.parse(historyData);
            }

            const items = [];
            for (const id of historyList.slice(0, 50)) {
                try {
                    const itemData = await env.GENERATIONS.get(id);
                    if (itemData) {
                        const item = JSON.parse(itemData);
                        items.push({
                            id: item.id,
                            prompt: item.prompt || 'No prompt',
                            url: item.url || '',
                            type: item.type || 'image',
                            created: item.created || Date.now()
                        });
                    }
                } catch (e) {
                    console.error('Error fetching item:', id, e);
                }
            }

            return new Response(JSON.stringify({ items }), {
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        } catch (error) {
            console.error('History error:', error);
            return new Response(JSON.stringify({ 
                items: [],
                error: error.message 
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // ============================================================
    // ENDPOINT 2: GET /api/history/:id - Fetch single item
    // ============================================================
    if (request.method === 'GET' && path.startsWith('/api/history/')) {
        const id = path.split('/').pop();
        
        try {
            if (!env.GENERATIONS) {
                return new Response(JSON.stringify({ error: 'KV binding not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const itemData = await env.GENERATIONS.get(id);
            if (!itemData) {
                return new Response(JSON.stringify({ error: 'Not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            const item = JSON.parse(itemData);
            return new Response(JSON.stringify(item), {
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // ============================================================
    // ENDPOINT 3: POST /api/generate - Generate new content
    // ============================================================
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

            console.log('Generating image with prompt:', prompt);
            
            // Generate image using Cloudflare Workers AI
            const model = '@cf/black-forest-labs/flux-1-schnell';
            const aiResponse = await env.AI.run(model, {
                prompt: prompt,
                width: 1024,
                height: 1024
            });

            console.log('AI response received. Type:', typeof aiResponse);
            console.log('AI response keys:', aiResponse ? Object.keys(aiResponse) : 'null');

            // ============================================================
            // FIX: Properly handle different response formats
            // ============================================================
            let imageUrl = null;
            let imageBytes = null;

            // Check if response is already a base64 image
            if (typeof aiResponse === 'string') {
                if (aiResponse.startsWith('data:image')) {
                    // Direct data URL
                    imageUrl = aiResponse;
                    console.log('Received direct data URL');
                } else if (aiResponse.startsWith('/9j/') || aiResponse.match(/^[A-Za-z0-9+/=]+$/)) {
                    // Raw base64 without prefix
                    imageUrl = `data:image/jpeg;base64,${aiResponse}`;
                    console.log('Received raw base64');
                } else {
                    // Try to parse as JSON
                    try {
                        const parsed = JSON.parse(aiResponse);
                        if (parsed.image) {
                            imageUrl = parsed.image;
                        } else if (parsed.url) {
                            imageUrl = parsed.url;
                        } else if (parsed.data) {
                            imageUrl = `data:image/jpeg;base64,${parsed.data}`;
                        }
                    } catch (e) {
                        console.log('Could not parse as JSON, using as-is');
                    }
                }
            } 
            // Check if response is an object
            else if (typeof aiResponse === 'object' && aiResponse !== null) {
                if (aiResponse.image) {
                    imageUrl = aiResponse.image;
                } else if (aiResponse.url) {
                    imageUrl = aiResponse.url;
                } else if (aiResponse.data) {
                    imageUrl = `data:image/jpeg;base64,${aiResponse.data}`;
                } else if (aiResponse.output) {
                    if (Array.isArray(aiResponse.output) && aiResponse.output.length > 0) {
                        imageUrl = aiResponse.output[0];
                    } else if (typeof aiResponse.output === 'string') {
                        imageUrl = aiResponse.output;
                    }
                }
                // Check for results array (common in some AI responses)
                if (!imageUrl && aiResponse.results && Array.isArray(aiResponse.results)) {
                    const result = aiResponse.results[0];
                    if (result) {
                        if (result.image) imageUrl = result.image;
                        else if (result.url) imageUrl = result.url;
                        else if (result.data) imageUrl = `data:image/jpeg;base64,${result.data}`;
                    }
                }
            }

            // If we still don't have an image URL, try to create one from bytes
            if (!imageUrl) {
                try {
                    // Try to convert response to ArrayBuffer
                    let arrayBuffer;
                    if (aiResponse instanceof ReadableStream) {
                        arrayBuffer = await new Response(aiResponse).arrayBuffer();
                    } else if (aiResponse instanceof ArrayBuffer) {
                        arrayBuffer = aiResponse;
                    } else if (typeof aiResponse === 'object' && aiResponse !== null) {
                        // Try to get bytes from object
                        if (aiResponse.bytes) {
                            arrayBuffer = aiResponse.bytes;
                        } else if (aiResponse.buffer) {
                            arrayBuffer = aiResponse.buffer;
                        }
                    }

                    if (arrayBuffer) {
                        const bytes = new Uint8Array(arrayBuffer);
                        let binary = '';
                        for (let i = 0; i < bytes.length; i++) {
                            binary += String.fromCharCode(bytes[i]);
                        }
                        const base64 = btoa(binary);
                        imageUrl = `data:image/jpeg;base64,${base64}`;
                        console.log('Created image URL from bytes, length:', binary.length);
                    }
                } catch (e) {
                    console.error('Error converting bytes:', e);
                }
            }

            // If we still don't have an image, use a fallback
            if (!imageUrl) {
                console.error('Could not extract image from response:', JSON.stringify(aiResponse).substring(0, 500));
                return new Response(JSON.stringify({
                    error: 'Could not generate image. Please try again.',
                    responseType: typeof aiResponse,
                    responsePreview: JSON.stringify(aiResponse).substring(0, 200)
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Generate unique ID
            const id = `gen_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

            // Store in KV if available
            const generationData = {
                id: id,
                prompt: prompt,
                type: mode === 'video' ? 'video' : 'image',
                url: imageUrl,
                created: Date.now()
            };

            try {
                if (env.GENERATIONS) {
                    await env.GENERATIONS.put(id, JSON.stringify(generationData));

                    let historyList = [];
                    try {
                        const historyData = await env.GENERATIONS.get('history_list');
                        if (historyData) {
                            historyList = JSON.parse(historyData);
                        }
                    } catch (e) {
                        // List doesn't exist yet
                    }

                    historyList.unshift(id);
                    if (historyList.length > 50) {
                        historyList = historyList.slice(0, 50);
                    }
                    await env.GENERATIONS.put('history_list', JSON.stringify(historyList));
                    console.log('Stored in KV with ID:', id);
                }
            } catch (kvError) {
                console.error('KV storage error:', kvError);
            }

            // Return response
            return new Response(JSON.stringify({
                type: mode === 'video' ? 'video' : 'image',
                url: imageUrl,
                id: id
            }), {
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });

        } catch (error) {
            console.error('Generation error:', error);
            return new Response(JSON.stringify({
                error: error.message || 'Internal server error',
                stack: error.stack
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
