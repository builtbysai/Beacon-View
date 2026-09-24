ALTER TABLE recordings
  ADD COLUMN encryption_version integer,
  ADD COLUMN encryption_iv bytea,
  ADD COLUMN encryption_data_key_ciphertext bytea,
  ADD COLUMN encryption_data_key_iv bytea,
  ADD CONSTRAINT recordings_encryption_valid CHECK (
    (encryption_version IS NULL AND encryption_iv IS NULL
      AND encryption_data_key_ciphertext IS NULL AND encryption_data_key_iv IS NULL)
    OR (encryption_version = 1 AND octet_length(encryption_iv) = 12
      AND octet_length(encryption_data_key_ciphertext) >= 17
      AND octet_length(encryption_data_key_iv) = 12)
  );
