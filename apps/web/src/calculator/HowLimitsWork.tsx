import { EuiButtonEmpty, EuiFlyout, EuiFlyoutBody, EuiFlyoutHeader, EuiText, EuiTitle } from '@elastic/eui';
import { useState } from 'react';

/** Plain-language explanation of Test hardware limits, for readers outside the field. */
export function HowLimitsWork() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <EuiButtonEmpty size="s" iconType="question" onClick={() => setOpen(true)}>How this works</EuiButtonEmpty>
      {open && (
        <EuiFlyout onClose={() => setOpen(false)} size="s" ownFocus aria-labelledby="how-limits-title">
          <EuiFlyoutHeader hasBorder>
            <EuiTitle size="s"><h2 id="how-limits-title">How Test hardware limits works</h2></EuiTitle>
          </EuiFlyoutHeader>
          <EuiFlyoutBody>
            <EuiText size="s">
              <p><strong>Think of the hardware as a warehouse.</strong> This mode works out how much stock the warehouse can take in each day before something runs out.</p>

              <p><strong>It checks several ways the warehouse could run out:</strong></p>
              <ul>
                <li><strong>Shelf space on each shelf.</strong> Data lives on shelves by age: fast shelves for new data, cheaper ones for old. Each shelf's space depends on how many days you keep data there, how many spare copies you keep, and how tightly the data packs.</li>
                <li><strong>The back room.</strong> The oldest data sits in cheap outside storage. The warehouse keeps only a small cache of it on site.</li>
                <li><strong>Workers at the loading dock.</strong> Processors can only unpack so much each day. This estimate is the roughest one.</li>
                <li><strong>The dock door.</strong> How fast disks can write, if you enter it.</li>
                <li><strong>The filing system.</strong> Data is stored in labelled boxes (shards), and the warehouse can only track so many. More stock means more boxes.</li>
              </ul>
              <p>Other questions use the same idea. For machine learning, Fleet agents, and AI search data, it checks the matching resource: machine learning nodes, Fleet Servers, and the memory set aside for that data.</p>

              <p><strong>It plans as if one building is closed.</strong> The biggest server on each shelf is left out, and space is never filled to the brim. Counting everything would make the answer look bigger, and the first failed server would leave the warehouse overfull.</p>

              <p><strong>The lowest ceiling wins.</strong> Each check gives its own maximum, and the smallest becomes the answer. The results name it as "Runs out first".</p>

              <p><strong>What to do next:</strong></p>
              <ol>
                <li>Read what "Runs out first" names; that is where extra hardware would help.</li>
                <li>Open any number to see each step behind it (the magnifying-glass icon).</li>
                <li>Test the loading-dock estimate with real data before relying on it (Rally, Elastic's benchmarking tool).</li>
              </ol>

              <p><strong>The honest risk:</strong> the tool does not model how busy the warehouse gets when many people search it at once. If the customer searches heavily, real limits can arrive sooner than shown. A benchmark on their own data will show it.</p>
            </EuiText>
          </EuiFlyoutBody>
        </EuiFlyout>
      )}
    </>
  );
}
