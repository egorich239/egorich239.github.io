bits 64
default rel
;; stage0.asm - BFG stage0 self-compiler
;;
;; Parses hex bytes from semicolon comment lines, emits raw machine code.
;; Its source is the text right after its own code, terminated by a NUL.
;; Input: rdi = decode target -- the SysV register of stage0(output).
;; A semicolon flips comment and code mode, starting in comment mode. In
;; code mode every char but an uppercase hex digit is skipped, and every
;; second digit emits a byte.
;; At exit: rsi rides past the NUL, rdi is the raw decode cursor, and
;; the ret consumes the image base parked at entry.

FLAG_EMIT   equ 0x80

stage0:
    push rdi
    lea rsi, [rel source]
    xor ecx, ecx                ;; ch: code mode, cl: 0x80=a pending nibble

.next_char:
    lodsb
    test al, al
    jz .done                    ;; leave on NUL

    cmp al, 0x3B                ;; semicolon
    jne .not_semi
    not ch                      ;; switch state on semicolon
    ;; fall through: a semicolon is no hex digit, so it is skipped below

.not_semi:
    test ch, ch
    jz .next_char               ;; comment mode, skip

    sub al, '0'
    cmp al, 10
    jb .got_digit               ;; 0..9
    sub al, 'A' - '0'
    cmp al, 6
    jae .next_char              ;; not a hex digit, skip
    add al, 10                  ;; A..F

.got_digit:
    shl edx, 4
    or dl, al
    xor cl, FLAG_EMIT           ;; flip emit flag
    js .next_char               ;; check sign
    mov al, dl                  ;; if it's ZERO - emit
    stosb
    jmp .next_char

.done:
    ret                         ;; jmp the image base parked at entry
                                ;; rsi rides past the NUL, rdi is the
                                ;; decode cursor -- the hosted driver
                                ;; reads both from the fault this jmp
                                ;; takes on its RW- page

source:
