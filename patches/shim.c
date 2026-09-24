/*
 * shim.c -- the sixth and seventh "patches": everything that has to be added
 * rather than changed, so that the f2c output of MOPAC 7.00 links under
 * wasm-ld.
 *
 * Compiled as one extra translation unit; nothing under the pristine MOPAC or
 * libf2c trees is edited. Two distinct problems live here.
 *
 * (A) ROUTINES libf2c DOES NOT PROVIDE
 *     MOPAC 7 uses two Unix f77 extensions that netlib libf2c has no
 *     implementation for:
 *       - FDATE(buf)  -- the run's date stamp printed in the banner.
 *       - MYFLSH(unit) -- see patches/fortran/0001; the renamed FLUSH(unit).
 *     Without them the link fails outright with undefined symbols.
 *
 * (B) RETURN-TYPE MISMATCHES INSIDE libf2c
 *     f2c declares every Fortran subroutine as returning int, but netlib
 *     libf2c defines s_copy, s_cat and getenv_ as void. Native linkers do
 *     not care. wasm-ld does: it refuses to merge a call whose signature
 *     differs from the definition and links a TRAPPING STUB instead, so the
 *     module dies on the first string assignment with a bare
 *
 *         RuntimeError: unreachable
 *
 *     and no message at all. (MOPAC's very first s_copy is in datin.c, so in
 *     practice nothing runs.) The wrappers below restore the int-returning
 *     signature f2c expects. The three libf2c sources are compiled with
 *     -Ds_copy=s_copy_impl -Ds_cat=s_cat_impl -Dgetenv_=getenv_impl so the
 *     real implementations keep their code under a private name; see
 *     scripts/build-wasm.sh. Patching libf2c itself was rejected: the rename
 *     survives a netlib refresh of libf2c.zip, a patch would not.
 *
 * Nothing here is MOPAC science -- no numerical path passes through this file.
 */
#include <string.h>
#include <time.h>

#include "f2c.h"

extern void s_copy_impl(char *a, char *b, ftnlen la, ftnlen lb);
extern void s_cat_impl(char *lp, char **rpp, ftnlen *rnp, ftnlen *np, ftnlen ll);
extern void getenv_impl(char *fname, char *value, ftnlen flen, ftnlen vlen);

int s_copy(char *a, char *b, ftnlen la, ftnlen lb) {
  s_copy_impl(a, b, la, lb);
  return 0;
}

int s_cat(char *lp, char **rpp, ftnlen *rnp, ftnlen *np, ftnlen ll) {
  s_cat_impl(lp, rpp, rnp, np, ll);
  return 0;
}

int getenv_(char *fname, char *value, ftnlen flen, ftnlen vlen) {
  getenv_impl(fname, value, flen, vlen);
  return 0;
}

/*
 * FDATE(buf): the Unix f77 extension MOPAC calls for its banner. Blank-padded
 * to the caller's declared length, as Fortran CHARACTER assignment requires.
 */
int fdate_(char *buf, ftnlen buf_len) {
  time_t now = time(0);
  char stamp[64];
  size_t length;

  strcpy(stamp, ctime(&now));
  length = strlen(stamp);
  if (length > 0 && stamp[length - 1] == '\n') stamp[--length] = '\0';
  if ((ftnlen)length > buf_len) length = (size_t)buf_len;
  memcpy(buf, stamp, length);
  if ((ftnlen)length < buf_len) memset(buf + length, ' ', (size_t)buf_len - length);
  return 0;
}

/*
 * MYFLSH(unit): what patches/fortran/0001 renamed ef.f's FLUSH(unit) to.
 * MOPAC's own COMMON /FLUSHX/ NFLUSH is never assigned, so NFLUSH is 0 and
 * this is unreachable; it exists so the call site links. Flushing a MEMFS
 * unit is a no-op anyway -- libf2c already writes through.
 */
int myflsh_(integer *unit) {
  (void)unit;
  return 0;
}
