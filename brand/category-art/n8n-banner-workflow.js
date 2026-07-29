// n8n Workflow-SDK script: generate the four SPORTA category banners with
// gpt-image-1 and upload them to public_html/cats/ over FTP.
//
// Validated against the n8n Workflow SDK (validate_workflow: valid). Import in
// n8n via "Create workflow → with code", or have Claude install it through the
// n8n MCP in an interactive session. Credential IDs reference the existing
// "n8n free OpenAI API credits" and "FTP account" credentials in this n8n
// account; adjust if yours differ (n8n → Credentials).
//
// Safety: writes ONLY /public_html/cats/<slug>.jpg — four files, additive,
// each reversible by deleting the file (the site then falls back to its
// designed artwork). Never touches config.js, knet/, pay/ or anything else.
//
// Before first run: confirm /public_html/cats exists (hPanel File Manager →
// create the folder if missing; n8n's FTP upload does not create directories).
import { workflow, node, trigger, splitInBatches, nextBatch } from '@n8n/workflow-sdk';

const STYLE =
  ' Premium commercial sportswear photography, in the style of a Nike or Gymshark category banner.' +
  ' Photorealistic, razor sharp, natural skin tones, professional colour grading.' +
  ' Dark charcoal studio environment with dramatic cinematic rim lighting in burnt orange (#FF6A00) and deep shadows.' +
  ' High contrast, minimal background, generous dark negative space on the LEFT third of the frame for a headline.' +
  ' Subject occupies the right two-thirds. No text, no logos, no watermarks.';

const BRIEFS = [
  { slug: 'men', brief: 'An athletic Middle Eastern male model with a muscular build, mid-workout in a modern dark gym, gripping a barbell for a deadlift, chalk dust in the air catching the orange rim light. Wearing premium unbranded black training tee and shorts. Confident, focused expression.' },
  { slug: 'women', brief: 'An athletic female model in premium matte-black high-waist leggings and fitted training top, holding a strong low lunge with dumbbells, in a dark modern studio. Elegant, powerful, poised. Orange rim light tracing her silhouette, soft key light on the face.' },
  { slug: 'accessories', brief: 'A luxury still-life composition on dark slate: a black gym duffel bag standing as the hero, surrounded by a matte black insulated bottle, a protein shaker, lifting straps, a folded charcoal towel, a black baseball cap, resistance bands (one in burnt orange as the single colour accent), and a sports watch. Dramatic side lighting, long soft shadows.' },
  { slug: 'outlet', brief: 'A premium dark retail interior: industrial shelving and racks stocked with folded sportswear, shoeboxes and trainers, lit by warm orange accent strips along the shelf edges. Depth of field falling away into the store. Luxury outlet mood, clean, modern, not cluttered.' },
];

const startTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Start', position: [220, 300] },
  output: [{}]
});

const makeBriefs = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Category Briefs',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode:
        'const style = ' + JSON.stringify(STYLE) + ';\n' +
        'const briefs = ' + JSON.stringify(BRIEFS) + ';\n' +
        'return briefs.map(b => ({ json: { slug: b.slug, prompt: b.brief + style } }));'
    },
    position: [440, 300]
  },
  output: [{ slug: 'men', prompt: 'An athletic Middle Eastern male model...' }]
});

const generateImage = node({
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 2.3,
  config: {
    name: 'Generate Banner',
    parameters: {
      resource: 'image',
      operation: 'generate',
      modelId: { __rl: true, mode: 'id', value: 'gpt-image-1' },
      prompt: { __expr: true, value: "={{ $json.prompt }}" },
      options: { quality: 'high', size: '1536x1024', binaryPropertyOutput: 'data' }
    },
    credentials: { openAiApi: { id: 'ChPoz4yYfy4id7cM', name: 'n8n free OpenAI API credits' } },
    position: [880, 300]
  },
  output: [{}]
});

const encodeJpeg = node({
  type: 'n8n-nodes-base.editImage',
  version: 1,
  config: {
    name: 'Encode JPEG',
    parameters: {
      operation: 'resize',
      dataPropertyName: 'data',
      width: 1600,
      height: 1200,
      resizeOption: 'onlyIfLarger',
      options: {
        format: 'jpeg',
        quality: 84,
        fileName: { __expr: true, value: "={{ $('Category Briefs').item.json.slug }}.jpg" }
      }
    },
    position: [1100, 300]
  },
  output: [{}]
});

const uploadFtp = node({
  type: 'n8n-nodes-base.ftp',
  version: 1,
  config: {
    name: 'Upload to public_html/cats',
    parameters: {
      protocol: 'ftp',
      operation: 'upload',
      path: { __expr: true, value: "=/public_html/cats/{{ $('Category Briefs').item.json.slug }}.jpg" },
      binaryData: true
    },
    credentials: { ftp: { id: '2b7mbpEzrTEHUBQz', name: 'FTP account' } },
    position: [1320, 300]
  },
  output: [{}]
});

const verifyListing = node({
  type: 'n8n-nodes-base.ftp',
  version: 1,
  config: {
    name: 'Verify cats listing',
    parameters: { protocol: 'ftp', operation: 'list', path: '/public_html/cats', recursive: false },
    credentials: { ftp: { id: '2b7mbpEzrTEHUBQz', name: 'FTP account' } },
    executeOnce: true,
    position: [1100, 120]
  },
  output: [{ name: 'men.jpg', size: 250000 }]
});

const perBanner = splitInBatches({
  version: 3,
  config: { name: 'One banner at a time', parameters: { batchSize: 1 }, position: [660, 300] }
});

export default workflow('sporta-category-banners', 'SPORTA — generate + deploy category banners')
  .add(startTrigger)
  .to(makeBriefs)
  .to(perBanner
    .onDone(verifyListing)
    .onEachBatch(generateImage.to(encodeJpeg).to(uploadFtp).to(nextBatch(perBanner)))
  );
