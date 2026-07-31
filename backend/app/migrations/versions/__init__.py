from .v0001_standard_targets import upgrade as upgrade_standard_targets
from .v0002_assessment_inheritance_revision import (
    upgrade as upgrade_assessment_inheritance_revision,
)
from .v0003_assessment_explicit_clear import (
    upgrade as upgrade_assessment_explicit_clear,
)
from .v0004_legacy_draft_target_repair import (
    upgrade as upgrade_legacy_draft_target_repair,
)
from .v0005_capability_standard_versioning import (
    upgrade as upgrade_capability_standard_versioning,
)
from .v0006_assessment_scope_snapshots import (
    upgrade as upgrade_assessment_scope_snapshots,
)

MIGRATIONS = [
    ("0001_standard_targets", upgrade_standard_targets),
    (
        "0002_assessment_inheritance_revision",
        upgrade_assessment_inheritance_revision,
    ),
    ("0003_assessment_explicit_clear", upgrade_assessment_explicit_clear),
    ("0004_legacy_draft_target_repair", upgrade_legacy_draft_target_repair),
    ("0005_capability_standard_versioning", upgrade_capability_standard_versioning),
    ("0006_assessment_scope_snapshots", upgrade_assessment_scope_snapshots),
]

__all__ = ["MIGRATIONS"]
