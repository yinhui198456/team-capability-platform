import hashlib
import secrets

_SALT_BYTES = 16
_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_HASH_LENGTH = 32


def hash_password(password: str, salt: str | None = None) -> str:
    """Hash a password using hashlib.scrypt with a unique random salt.

    The returned string format is ``f"{salt}${scrypt_hash}"`` where both
    values are lowercase hex so they can be stored in a single text column.
    """
    if salt is None:
        salt = secrets.token_hex(_SALT_BYTES)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt.encode("utf-8"),
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_HASH_LENGTH,
    ).hex()
    return f"{salt}${digest}"


def verify_password(password: str, hashed: str) -> bool:
    """Recompute the scrypt hash and compare using a constant-time check."""
    if "$" not in hashed:
        return False
    salt, stored_digest = hashed.split("$", 1)
    if len(salt) != _SALT_BYTES * 2 or len(stored_digest) != _HASH_LENGTH * 2:
        return False
    expected = hash_password(password, salt).split("$", 1)[1]
    return secrets.compare_digest(expected, stored_digest)


def generate_session_token() -> str:
    """Return a high-entropy URL-safe token that is never persisted raw."""
    return secrets.token_hex(32)


def hash_session_token(token: str) -> str:
    """Return the lowercase hex SHA-256 digest of a raw session token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
