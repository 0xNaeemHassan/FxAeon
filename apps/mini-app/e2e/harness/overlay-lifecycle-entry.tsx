import React from 'react';
import { createRoot } from 'react-dom/client';
import OverlayLifecycleHarness from './overlay-lifecycle';

document.documentElement.dataset.harnessReady = 'true';
createRoot(document.getElementById('root')!).render(<React.StrictMode><OverlayLifecycleHarness /></React.StrictMode>);
