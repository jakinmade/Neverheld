# Next.js integration

Serve `public/neverheld/neverheld.min.js` from the app's origin. Add the tag after required scripts and before protected data can be opened:

```tsx
<script src="/neverheld/neverheld.min.js" data-auto-seal data-application="Your application" />
```

The one-tag mode intentionally blocks later network requests. Load required resources first. Do not treat the tag as worker isolation evidence. Applications using PDF/OCR, dedicated/shared workers or service workers must enforce and test their worker policies separately and use the integrated API. Run the full workflow with the internet disabled after sealing.
