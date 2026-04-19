export type EngineExtraArgDoc = {
    flag: string;
    description: string;
};

export type EngineExtraArgDocs = {
    title: string;
    subtitle: string;
    items: EngineExtraArgDoc[];
};

export function getEngineExtraArgDocs(appId: string): EngineExtraArgDocs {
    if (appId === 'sdcpp' || appId === 'stable-diffusion') {
        return {
            title: 'Manual sd.cpp flags',
            subtitle:
                'These go into Extra Arguments as startup flags. Generation fields like steps, sampler, scheduler and seed are already controlled by the launcher UI.',
            items: [
                { flag: '--fa', description: 'Enable flash attention globally.' },
                {
                    flag: '--vae C:\\Models\\qwen_image_vae.safetensors',
                    description: 'Required companion VAE for Qwen Image GGUF models.',
                },
                {
                    flag: '--llm C:\\Models\\Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf',
                    description: 'Required companion LLM for Qwen Image GGUF models.',
                },
                {
                    flag: '--vae-tiling',
                    description: 'Use tiled VAE decoding to reduce VRAM usage.',
                },
                {
                    flag: '--diffusion-fa',
                    description: 'Enable flash attention for the diffusion model only.',
                },
                { flag: '--mmap', description: 'Memory-map model weights from disk.' },
                {
                    flag: '--offload-to-cpu',
                    description: 'Keep more weights in RAM to reduce VRAM pressure.',
                },
                { flag: '--clip-on-cpu', description: 'Run CLIP on CPU for low-VRAM setups.' },
                { flag: '--vae-on-cpu', description: 'Run VAE on CPU for low-VRAM setups.' },
                {
                    flag: '--control-net-cpu',
                    description: 'Run ControlNet on CPU when ControlNet is used.',
                },
                {
                    flag: '--vae-tile-size 64x64',
                    description: 'Increase tile size when using VAE tiling.',
                },
                {
                    flag: '--vae-relative-tile-size 0.5x0.5',
                    description: 'Tile VAE relative to image size.',
                },
                { flag: '--rng cuda', description: 'Prefer CUDA RNG on NVIDIA systems.' },
                {
                    flag: '--sampler-rng cuda',
                    description: 'Use CUDA RNG specifically for the sampler.',
                },
            ],
        };
    }

    return {
        title: 'Manual llama.cpp flags',
        subtitle:
            'These are appended to llama-server startup. Context window and GPU layers are already managed by the launcher UI.',
        items: [
            { flag: '--flash-attn', description: 'Enable flash attention if supported.' },
            { flag: '--threads 8', description: 'Set explicit CPU thread count.' },
            { flag: '--parallel 1', description: 'Limit parallel slots for stability.' },
            { flag: '--mlock', description: 'Keep model memory pinned in RAM.' },
            { flag: '--no-mmap', description: 'Disable mmap if storage causes issues.' },
        ],
    };
}
