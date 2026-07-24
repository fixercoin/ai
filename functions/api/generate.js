// functions/api/generate.js
// FIXED: Proper routing for all endpoints

export async function onRequest(context) {
    const { request, env, next } = context;
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
        console.log('Handling /api/history request');
        try {
            if (!env.GENERATIONS) {
                return new Response(JSON.stringify({ 
                    items: [],
                    message: 'History storage is not available'
                }), {
                    status: 200,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }

            let historyList = [];
            const historyData = await env.GENERATIONS.get('history_list');
            if (historyData) {
                historyList = JSON.parse(historyData);
                console.log('History list length:', historyList.length);
            }

            const items = [];
            for (const id of historyList.slice(0, 50)) {
                try {
                    const itemData = await env.GENERATIONS.get(id);
                    if (itemData) {
                        const item = JSON.parse(itemData);
                        // Ensure URL has data prefix if needed
                        let itemUrl = item.url || '';
                        if (typeof itemUrl === 'string' && itemUrl.startsWith('/9j/')) {
                            itemUrl = `data:image/jpeg;base64,${itemUrl}`;
                        }
                        items.push({
                            id: item.id,
                            prompt: item.prompt || 'No prompt',
                            url: itemUrl,
                            type: item.type || 'image',
                            created: item.created || Date.now()
                        });
                    }
                } catch (e) {
                    console.error('Error fetching item:', id, e);
                }
            }

            console.log('Returning', items.length, 'history items');
            return new Response(JSON.stringify({ items }), {
                status: 200,
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
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    }

    // ============================================================
    // ENDPOINT 2: GET /api/history/:id - Fetch single item
    // ============================================================
    if (request.method === 'GET' && path.startsWith('/api/history/')) {
        const id = path.split('/').pop();
        console.log('Handling /api/history/:id with ID:', id);
        
        try {
            if (!env.GENERATIONS) {
                return new Response(JSON.stringify({ error: 'KV binding not found' }), {
                    status: 404,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }

            const itemData = await env.GENERATIONS.get(id);
            if (!itemData) {
                return new Response(JSON.stringify({ error: 'Not found' }), {
                    status: 404,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            const item = JSON.parse(itemData);
            // Ensure URL has data prefix if needed
            if (item.url && typeof item.url === 'string' && item.url.startsWith('/9j/')) {
                item.url = `data:image/jpeg;base64,${item.url}`;
            }
            return new Response(JSON.stringify(item), {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        } catch (error) {
            console.error('History item error:', error);
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    }

    // ============================================================
    // ENDPOINT 3: POST /api/generate - Generate new content
    // ============================================================
    if (request.method === 'POST' && path === '/api/generate') {
        console.log('Handling /api/generate request');
        try {
            if (!env.AI) {
                return new Response(JSON.stringify({ 
                    error: 'AI binding not found. Please add AI binding in Cloudflare Dashboard.' 
                }), {
                    status: 500,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }

            const { prompt, mode } = await request.json();

            if (!prompt || prompt.trim().length === 0) {
                return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                    status: 400,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
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

            console.log('AI response type:', typeof aiResponse);
            
            // Extract image URL from response
            let imageUrl = null;

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
                                if (imgData.startsWith('/9j/')) {
                                    imgData = `data:image/jpeg;base64,${imgData}`;
                                } else {
                                    imgData = `data:image/jpeg;base64,${imgData}`;
                                }
                            }
                            imageUrl = imgData;
                        } else if (parsed.url) {
                            imageUrl = parsed.url;
                        } else if (parsed.data) {
                            imageUrl = `data:image/jpeg;base64,${parsed.data}`;
                        }
                    } catch (e) {
                        console.log('Not valid JSON');
                    }
                }
            } else if (typeof aiResponse === 'object' && aiResponse !== null) {
                if (aiResponse.image) {
                    let imgData = aiResponse.image;
                    if (typeof imgData === 'string' && !imgData.startsWith('data:image') && !imgData.startsWith('http')) {
                        if (imgData.startsWith('/9j/')) {
                            imgData = `data:image/jpeg;base64,${imgData}`;
                        } else {
                            imgData = `data:image/jpeg;base64,${imgData}`;
                        }
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
                            if (out.startsWith('/9j/')) {
                                out = `data:image/jpeg;base64,${out}`;
                            } else {
                                out = `data:image/jpeg;base64,${out}`;
                            }
                        }
                        imageUrl = out;
                    } else if (typeof aiResponse.output === 'string') {
                        let out = aiResponse.output;
                        if (!out.startsWith('data:image') && !out.startsWith('http')) {
                            if (out.startsWith('/9j/')) {
                                out = `data:image/jpeg;base64,${out}`;
                            } else {
                                out = `data:image/jpeg;base64,${out}`;
                            }
                        }
                        imageUrl = out;
                    }
                } else if (aiResponse.results && Array.isArray(aiResponse.results) && aiResponse.results.length > 0) {
                    const result = aiResponse.results[0];
                    if (result) {
                        if (result.image) {
                            let imgData = result.image;
                            if (typeof imgData === 'string' && !imgData.startsWith('data:image') && !imgData.startsWith('http')) {
                                if (imgData.startsWith('/9j/')) {
                                    imgData = `data:image/jpeg;base64,${imgData}`;
                                } else {
                                    imgData = `data:image/jpeg;base64,${imgData}`;
                                }
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

            // If we still don't have an image URL, try bytes conversion
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
                    console.error('Error converting bytes:', e);
                }
            }

            if (!imageUrl) {
                console.error('Could not extract image from response');
                return new Response(JSON.stringify({
                    error: 'Could not generate image. Please try again.',
                    responseType: typeof aiResponse
                }), {
                    status: 500,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }

            // Final URL fix
            if (typeof imageUrl === 'string' && !imageUrl.startsWith('data:image') && !imageUrl.startsWith('http')) {
                if (imageUrl.startsWith('/9j/')) {
                    imageUrl = `data:image/jpeg;base64,${imageUrl}`;
                } else {
                    imageUrl = `data:image/jpeg;base64,${imageUrl}`;
                }
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
                status: 200,
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
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    }

    // ============================================================
    // If no route matched, return 404 as JSON
    // ============================================================
    console.log('No route matched for:', path);
    return new Response(JSON.stringify({ 
        error: 'Not found',
        path: path,
        method: request.method
    }), {
        status: 404,
        headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
