export default {
    source: {
        type: 'local',
        // 來源照片目錄 (請確認此路徑是否正確，或修改為實際照片存放位置)
        path: '/mnt/hdd16tb_01/nas-storage/Blog_Source',
        // 排除規則 (例如排除縮圖、隱藏檔)
        excludeRegex: '(@eaDir|\\.DS_Store|thumbs|cache|gallery)',
    },

    output: {
        // 生成的縮圖與 manifest 存放位置 (對應後端的 storage/gallery)
        directory: '/mnt/hdd16tb_01/nas-storage/gallery',

        // manifest.json 路徑
        manifestPath: '/mnt/hdd16tb_01/nas-storage/gallery/manifest.json',
    },

    processing: {
        thumbnail: {
            width: 400,
            quality: 80,
            format: 'webp',
        },

        highRes: {
            maxWidth: 1920,
            quality: 85,
            format: 'webp',
        },

        enableThumbHash: true,
    },
};
