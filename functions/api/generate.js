// functions/api/generate.js
// Complete Pages Function with ALL endpoints

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // ============================================================
    // ENDPOINT 1: GET /api/history - Fetch all history
    // ============================================================
    if (request.method === 'GET' && path === '/api/history') {
        try {
            let historyList = [];
            
            // Get the history list from KV
            const historyData = await env.GENERATIONS.get('history_list');
            if (historyData) {
                historyList = JSON.parse(historyData);
            }

            // Fetch each item from KV
            const items = [];
            for (const id of historyList.slice(0, 50)) { // Limit to 50 items
                try {
                    const itemData = await env.GENERATIONS.get(id);
                    if (itemData) {
                        const item = JSON.parse(itemData);
                        items.push({
                            id: item.id,
                            prompt: item.prompt,
                            url: item.url,
                            type: item.type,
                            created: item.created
                        });
                    }
                } catch (e) {
                    // Skip invalid items
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
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
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
            const { prompt, mode } = await request.json();

            if (!prompt || prompt.trim().length === 0) {
                return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // --------------------------------------------------------
            // STEP 1: Generate Image using Cloudflare Workers AI
            // --------------------------------------------------------
            const model = '@cf/black-forest-labs/flux-1-schnell';
            const aiResponse = await env.AI.run(model, {
                prompt: prompt,
                width: 1024,
                height: 1024
            });

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

            // --------------------------------------------------------
            // STEP 2: Store in KV
            // --------------------------------------------------------
            const generationData = {
                id: id,
                prompt: prompt,
                type: mode === 'video' ? 'video' : 'image',
                url: imageUrl,
                created: Date.now()
            };

            // Store individual item
            await env.GENERATIONS.put(id, JSON.stringify(generationData));

            // Update history list
            let historyList = [];
            try {
                const historyData = await env.GENERATIONS.get('history_list');
                if (historyData) {
                    historyList = JSON.parse(historyData);
                }
            } catch (e) {
                // List doesn't exist yet
            }

            // Add new ID to the beginning (max 50 items)
            historyList.unshift(id);
            if (historyList.length > 50) {
                historyList = historyList.slice(0, 50);
            }
            await env.GENERATIONS.put('history_list', JSON.stringify(historyList));

            // --------------------------------------------------------
            // STEP 3: Return response
            // --------------------------------------------------------
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
    return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
    });
}
