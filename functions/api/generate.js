// functions/api/generate.js
// Complete Pages Function with ALL endpoints and better error handling

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
        try {
            // Check if KV exists
            if (!env.GENERATIONS) {
                return new Response(JSON.stringify({ 
                    items: [],
                    error: 'KV binding not found',
                    message: 'History storage is not available, but generation still works!'
                }), {
                    status: 200, // Return 200 with empty items instead of 500
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
                status: 200, // Return 200 with empty items
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
                return new Response(JSON.stringify({ 
                    error: 'KV binding not found' 
                }), {
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
            // Check if AI binding exists
            if (!env.AI) {
                return new Response(JSON.stringify({ 
                    error: 'AI binding not found. Please add AI binding in Cloudflare Dashboard.\n\nInstructions:\n1. Go to your Pages project\n2. Settings → Functions\n3. Add binding → Workers AI\n4. Variable name: AI\n5. Click Save' 
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

            console.log('AI response received');

            // Convert AI response to image bytes
            let imageBytes;
            if (typeof aiResponse === 'string' && aiResponse.startsWith('data:image')) {
                const base64 = aiResponse.split(',')[1];
                imageBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            } else if (aiResponse instanceof ReadableStream) {
                imageBytes = await new Response(aiResponse).arrayBuffer();
            } else if (aiResponse instanceof ArrayBuffer) {
                imageBytes = aiResponse;
            } else {
                imageBytes = new Uint8Array(aiResponse);
            }

            // Convert to base64 for display
            const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBytes)));
            const imageUrl = `data:image/jpeg;base64,${base64Image}`;

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
                // Continue even if KV fails
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
                details: error.stack || 'No stack trace available'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // ============================================================
    // 404 - Not found - Return JSON instead of HTML
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
