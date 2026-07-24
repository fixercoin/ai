// functions/api/generate.js
// Cloudflare Pages Function with KV storage and AI generation

export async function onRequest(context) {
    const { request, env } = context;

    // Parse URL to handle different endpoints
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle GET requests for history
    if (request.method === 'GET' && path === '/api/history') {
        return handleHistory(env);
    }

    // Handle GET requests for single history item
    if (request.method === 'GET' && path.startsWith('/api/history/')) {
        const id = path.split('/').pop();
        return handleHistoryItem(env, id);
    }

    // Only accept POST for generation
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const { prompt, mode } = await request.json();

        if (!prompt || prompt.trim().length === 0) {
            return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ============================================================
        // STEP 1: Generate Image using Cloudflare Workers AI
        // Model: Flux 1 Schnell (fastest, free tier ~1,000 images/day)
        // ============================================================

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

        // Generate a unique ID for this generation
        const id = `gen_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        // ============================================================
        // STEP 2: Store in KV
        // ============================================================
        // KV namespace binding is called 'GENERATIONS' 
        // Access via context.env.GENERATIONS

        const generationData = {
            id: id,
            prompt: prompt,
            type: mode === 'video' ? 'video' : 'image',
            url: imageUrl,
            created: Date.now()
        };

        // Store in KV with key = id, value = JSON string
        await env.GENERATIONS.put(id, JSON.stringify(generationData));

        // Also store in a list for history (using a list key)
        let historyList = [];
        try {
            const historyData = await env.GENERATIONS.get('history_list');
            if (historyData) {
                historyList = JSON.parse(historyData);
            }
        } catch (e) {
            // List doesn't exist yet
        }

        // Add new ID to the beginning of the list (max 50 items)
        historyList.unshift(id);
        if (historyList.length > 50) {
            historyList = historyList.slice(0, 50);
        }
        await env.GENERATIONS.put('history_list', JSON.stringify(historyList));

        // ============================================================
        // STEP 3: Handle Video Mode
        // ============================================================
        // Note: Cloudflare Workers AI doesn't generate videos yet.
        // For real video, you'd need a separate service.
        // This implementation stores the image and returns it with video type.
        // For true video, consider using slideshow-cli which uses
        // Cloudflare Workers AI + Pexels + ffmpeg [citation:4].

        if (mode === 'video') {
            return new Response(JSON.stringify({
                type: 'video',
                url: imageUrl,
                id: id
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ============================================================
        // STEP 4: Return Image
        // ============================================================

        return new Response(JSON.stringify({
            type: 'image',
            url: imageUrl,
            id: id
        }), {
            headers: { 'Content-Type': 'application/json' }
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
// Helper: Handle GET /api/history
// ============================================================
async function handleHistory(env) {
    try {
        let historyList = [];
        const historyData = await env.GENERATIONS.get('history_list');
        if (historyData) {
            historyList = JSON.parse(historyData);
        }

        // Fetch each item from KV
        const items = [];
        for (const id of historyList.slice(0, 20)) { // Limit to 20 items
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
            }
        }

        return new Response(JSON.stringify({ items }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// ============================================================
// Helper: Handle GET /api/history/:id
// ============================================================
async function handleHistoryItem(env, id) {
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
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
