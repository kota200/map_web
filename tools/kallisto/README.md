# Native Kallisto D2 source lock

Desktop Kallisto remains pinned to upstream version 0.52.0 at commit
`4e9f29cf3b021260415430c057a22469ca081391`, matching the existing Web runtime.
The Windows x64 build applies only the checked-in preparation script derived
from the upstream revision's own `.make_binaries.windows.txt` recipe. CI stores
that exact patch, the unmodified source archive, and checksums with the binary.

Kallisto and its bundled Bifrost code are BSD-2-Clause. The bundled zlib-ng
code uses the zlib license. Their complete texts are copied from the pinned
source tree into every generated sidecar package and registered by SHA-256 in
the platform manifest. `KALLISTO_LICENSE.txt` is the repository's local copy of
the Kallisto license.

Do not package a native Kallisto executable unless its `version` command
contains `0.52.0` and the generated manifest contains the exact binary hash.
